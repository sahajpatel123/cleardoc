#!/bin/bash
# Security Hardening Script for ClearDoc
# Run this script locally to verify security configurations

# Don't exit on error - we want to continue checking even if one check fails
# set -e

echo "=== ClearDoc Security Hardening Check ==="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PASS=0
FAIL=0

check_pass() {
    echo -e "${GREEN}✓ PASS${NC}: $1"
    ((PASS++))
}

check_fail() {
    echo -e "${RED}✗ FAIL${NC}: $1"
    ((FAIL++))
}

check_warn() {
    echo -e "${YELLOW}⚠ WARN${NC}: $1"
}

# 1. Check for hardcoded secrets, private keys, and provider tokens in tracked files
echo "--- Checking for hardcoded secrets ---"
if git grep -nE "(api[_-]?key|secret[_-]?key|client[_-]?secret|access[_-]?token|auth[_-]?token|private[_-]?key)[[:space:]]*[:=][[:space:]]*['\"][^'\"]{10,}['\"]|(sk_live_|pk_live_|sk_test_|pk_test_|ghp_|github_pat_|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|BEGIN (RSA|EC|OPENSSH|DSA|PGP) PRIVATE KEY)" -- "*.js" "*.ts" "*.mjs" "*.cjs" "*.json" "*.html" "*.css" "*.sh" "*.yml" "*.yaml" ':(exclude)scripts/security-hardening.sh' ':(exclude).github/workflows/security.yml' 2>/dev/null; then
    check_fail "Potential hardcoded secrets found (tracked files only)"
else
    check_pass "No hardcoded secrets detected in tracked files"
fi

# 2. Check for dangerous eval/Function usage
# Note: .\$eval is Playwright's method, not the dangerous eval() function
# Exclude .next directory (Vercel build output) and test files
echo ""
echo "--- Checking for dangerous code patterns ---"
if grep -rE "(^|[^\$])eval\s*\(" --include="*.js" \
    --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.opencode \
    --exclude-dir=.git --exclude-dir=.claude --exclude-dir=.openclaude \
    --exclude-dir=.antigravitycli --exclude-dir=test --exclude-dir=playwright-report --exclude-dir=test-results \
    . 2>/dev/null | grep -v "// " | grep -v "\.eval"; then
    check_fail "Dangerous eval() usage detected"
else
    check_pass "No dangerous eval() usage found"
fi

# 3. Verify SHA-pinned actions in workflows
echo ""
echo "--- Checking GitHub Actions SHA pins ---"
WORKFLOW_FILES=$(find .github/workflows -name "*.yml" -o -name "*.yaml" 2>/dev/null)
if [ -n "$WORKFLOW_FILES" ]; then
    HAS_TAGS=0
    for file in $WORKFLOW_FILES; do
        # Check for uses: action@version format (not SHA)
        if grep -E "uses:.*@[a-zA-Z]" "$file" 2>/dev/null | grep -v "# v"; then
            echo "  Found non-SHA-pinned action in $file"
            HAS_TAGS=1
        fi
    done

    if [ $HAS_TAGS -eq 0 ]; then
        check_pass "All actions are SHA-pinned"
    else
        check_fail "Some actions are not SHA-pinned"
    fi
else
    check_warn "No workflow files found"
fi

# 3b. Verify workflows declare read-only top-level permissions
echo ""
echo "--- Checking GitHub Actions least-privilege defaults ---"
if [ -n "$WORKFLOW_FILES" ]; then
    HAS_PERMS=0
    for file in $WORKFLOW_FILES; do
        # Top-level permissions: starts at column 0 and contains
        # `contents: read` before the next top-level key.
        if ! awk 'BEGIN{ok=0; inp=0}
                  /^permissions:/{inp=1; next}
                  inp && /^[A-Za-z]/{inp=0}
                  inp && /^[[:space:]]+contents: read/{ok=1}
                  END{exit !ok}' "$file"; then
            echo "  Missing top-level read permissions in $file"
            HAS_PERMS=1
        fi
    done

    if [ $HAS_PERMS -eq 0 ]; then
        check_pass "All workflows default to read-only permissions"
    else
        check_fail "Some workflows do not default to read-only permissions"
    fi
else
    check_warn "No workflow files found"
fi

# 3c. Verify every workflow job declares a timeout
echo ""
echo "--- Checking GitHub Actions job timeouts ---"
if [ -n "$WORKFLOW_FILES" ]; then
    HAS_TIMEOUT=0
    for file in $WORKFLOW_FILES; do
        # Count jobs and timeout-minutes entries after the top-level jobs: key.
        if ! awk 'BEGIN{jobs=0; tm=0; inj=0}
                  /^jobs:/{inj=1; next}
                  inj && /^[^[:space:]]/{inj=0}
                  inj && /^[[:space:]]{2}[A-Za-z0-9_-]+:$/{jobs++}
                  inj && /^[[:space:]]{4}timeout-minutes:/{tm++}
                  END{exit !(jobs>0 && tm>=jobs)}' "$file"; then
            echo "  Missing timeout-minutes in a job in $file"
            HAS_TIMEOUT=1
        fi
    done

    if [ $HAS_TIMEOUT -eq 0 ]; then
        check_pass "All workflow jobs declare timeout-minutes"
    else
        check_fail "Some workflow jobs are missing timeout-minutes"
    fi
else
    check_warn "No workflow files found"
fi

# 3d. Verify workflows declare concurrency groups
echo ""
echo "--- Checking GitHub Actions concurrency groups ---"
if [ -n "$WORKFLOW_FILES" ]; then
    HAS_CONCURRENCY=0
    for file in $WORKFLOW_FILES; do
        if ! grep -q '^concurrency:' "$file"; then
            echo "  Missing concurrency group in $file"
            HAS_CONCURRENCY=1
        fi
    done

    if [ $HAS_CONCURRENCY -eq 0 ]; then
        check_pass "All workflows declare concurrency groups"
    else
        check_fail "Some workflows are missing concurrency groups"
    fi
else
    check_warn "No workflow files found"
fi

# 3e. Verify npm audit gates remain in CI workflows
echo ""
echo "--- Checking GitHub Actions npm audit gates ---"
MISSING_AUDIT=""
for file in .github/workflows/test.yml .github/workflows/security.yml; do
    if [ -f "$file" ] && ! grep -q "npm audit --audit-level=high" "$file"; then
        MISSING_AUDIT="$MISSING_AUDIT $file"
    fi
done
if [ -z "$MISSING_AUDIT" ]; then
    check_pass "npm audit --audit-level=high is present in test and security workflows"
else
    check_fail "npm audit --audit-level=high missing in:$MISSING_AUDIT"
fi

# 3f. Verify CI uses npm ci for reproducible installs
echo ""
echo "--- Checking GitHub Actions npm ci usage ---"
MISSING_NPM_CI=""
for file in .github/workflows/test.yml .github/workflows/security.yml; do
    if [ -f "$file" ] && ! grep -q "npm ci" "$file"; then
        MISSING_NPM_CI="$MISSING_NPM_CI $file"
    fi
done
if [ -z "$MISSING_NPM_CI" ]; then
    check_pass "npm ci is used in test and security workflows"
else
    check_fail "npm ci missing in:$MISSING_NPM_CI"
fi

# 3g. Verify CodeQL disables fail-fast so one matrix leg can't abort all scans
echo ""
echo "--- Checking GitHub Actions CodeQL fail-fast ---"
if [ -f .github/workflows/codeql.yml ] && grep -q "fail-fast: false" .github/workflows/codeql.yml; then
    check_pass "CodeQL disables fail-fast"
else
    check_fail "CodeQL does not disable fail-fast"
fi

# 3h. Verify CodeQL can upload security events
echo ""
echo "--- Checking GitHub Actions CodeQL security-events ---"
if [ -f .github/workflows/codeql.yml ] && grep -q "security-events: write" .github/workflows/codeql.yml; then
    check_pass "CodeQL has security-events write permission"
else
    check_fail "CodeQL is missing security-events write permission"
fi

# 3i. Verify CodeQL ignores test-only changes
echo ""
echo "--- Checking GitHub Actions CodeQL test ignore ---"
if [ -f .github/workflows/codeql.yml ] && grep -q "test/\*\*" .github/workflows/codeql.yml; then
    check_pass "CodeQL ignores test-only changes"
else
    check_fail "CodeQL is missing test path ignore"
fi

# 3j. Verify browser smoke tests remain in CI
echo ""
echo "--- Checking GitHub Actions browser smoke coverage ---"
if [ -f .github/workflows/test.yml ] && grep -q "npm run test:smoke" .github/workflows/test.yml; then
    check_pass "Browser smoke tests are present in test workflow"
else
    check_fail "Browser smoke tests are missing from test workflow"
fi

# 3k. Verify JSON config validation remains in CI
echo ""
echo "--- Checking GitHub Actions JSON validation ---"
if [ -f .github/workflows/test.yml ] && grep -q "npm run validate:json" .github/workflows/test.yml; then
    check_pass "JSON config validation is present in test workflow"
else
    check_fail "JSON config validation is missing from test workflow"
fi

# 3l. Verify checkout steps do not persist credentials
echo ""
echo "--- Checking GitHub Actions checkout credential persistence ---"
MISSING_PERSIST=""
for file in .github/workflows/test.yml .github/workflows/security.yml .github/workflows/codeql.yml; do
    if [ -f "$file" ] && ! grep -q "persist-credentials: false" "$file"; then
        MISSING_PERSIST="$MISSING_PERSIST $file"
    fi
done
if [ -z "$MISSING_PERSIST" ]; then
    check_pass "Checkout does not persist credentials in workflows"
else
    check_fail "persist-credentials false missing in:$MISSING_PERSIST"
fi

# 3m. Verify setup-node caches npm dependencies
echo ""
echo "--- Checking GitHub Actions npm cache ---"
MISSING_CACHE=""
for file in .github/workflows/test.yml .github/workflows/security.yml; do
    if [ -f "$file" ] && ! grep -q "cache: npm" "$file"; then
        MISSING_CACHE="$MISSING_CACHE $file"
    fi
done
if [ -z "$MISSING_CACHE" ]; then
    check_pass "npm cache is enabled in test and security workflows"
else
    check_fail "npm cache missing in:$MISSING_CACHE"
fi

# 3n. Verify workflows support manual dispatch
echo ""
echo "--- Checking GitHub Actions workflow_dispatch ---"
MISSING_DISPATCH=""
for file in .github/workflows/test.yml .github/workflows/security.yml .github/workflows/codeql.yml; do
    if [ -f "$file" ] && ! grep -q "workflow_dispatch" "$file"; then
        MISSING_DISPATCH="$MISSING_DISPATCH $file"
    fi
done
if [ -z "$MISSING_DISPATCH" ]; then
    check_pass "All workflows support workflow_dispatch"
else
    check_fail "workflow_dispatch missing in:$MISSING_DISPATCH"
fi

# 3o. Verify the security hardening script runs in CI
echo ""
echo "--- Checking GitHub Actions hardening script run ---"
if [ -f .github/workflows/security.yml ] && grep -q "scripts/security-hardening.sh" .github/workflows/security.yml; then
    check_pass "Security hardening script runs in CI"
else
    check_fail "Security hardening script is missing from CI"
fi

# 3p. Verify the integration test suite remains wired into CI
echo ""
echo "--- Checking GitHub Actions integration test coverage ---"
MISSING_INTEGRATION=""
for file in .github/workflows/test.yml .github/workflows/security.yml; do
    if [ -f "$file" ] && ! grep -Eq "npm run test:integration|npm test" "$file"; then
        MISSING_INTEGRATION="$MISSING_INTEGRATION $file"
    fi
done
if [ -z "$MISSING_INTEGRATION" ]; then
    check_pass "Integration tests run in test and security workflows"
else
    check_fail "Integration tests missing from:$MISSING_INTEGRATION"
fi

# 3p2. Verify the unit test suite remains wired into CI
echo ""
echo "--- Checking GitHub Actions unit test coverage ---"
if [ -f .github/workflows/test.yml ] && grep -q "npm run test:unit" .github/workflows/test.yml; then
    check_pass "Unit tests run in the test workflow"
else
    check_fail "Unit tests are missing from the test workflow"
fi

# 3q. Verify CodeQL uses the broader security-and-quality query suite
echo ""
echo "--- Checking GitHub Actions CodeQL query suite ---"
if [ -f .github/workflows/codeql.yml ] && grep -q "security-and-quality" .github/workflows/codeql.yml; then
    check_pass "CodeQL uses the security-and-quality query suite"
else
    check_fail "CodeQL is missing the security-and-quality query suite"
fi

# 3s. Verify CodeQL has the minimum actions read permission
echo ""
echo "--- Checking GitHub Actions CodeQL actions permission ---"
if [ -f .github/workflows/codeql.yml ] && grep -q "actions: read" .github/workflows/codeql.yml; then
    check_pass "CodeQL grants actions read permission"
else
    check_fail "CodeQL is missing the actions read permission"
fi

# 3s2. Verify CodeQL skips docs/design-only changes
echo ""
echo "--- Checking GitHub Actions CodeQL docs ignore ---"
if [ -f .github/workflows/codeql.yml ] && grep -q "docs/\*\*" .github/workflows/codeql.yml && grep -q "design-concepts/\*\*" .github/workflows/codeql.yml; then
    check_pass "CodeQL ignores docs and design-only changes"
else
    check_fail "CodeQL is missing docs or design-concepts path ignores"
fi

# 3r. Verify syntax + JSON validation gates stay wired into CI
echo ""
echo "--- Checking GitHub Actions syntax and JSON validation gates ---"
MISSING_SYNTAX_JSON=""
for file in .github/workflows/test.yml .github/workflows/security.yml; do
    if [ -f "$file" ]; then
        if ! grep -q "npm run syntax" "$file" || ! grep -q "npm run validate:json" "$file"; then
            MISSING_SYNTAX_JSON="$MISSING_SYNTAX_JSON $file"
        fi
    fi
done
if [ -z "$MISSING_SYNTAX_JSON" ]; then
    check_pass "Syntax and JSON validation run in test and security workflows"
else
    check_fail "Syntax or JSON validation missing from:$MISSING_SYNTAX_JSON"
fi

# 3t. Verify the security workflow runs dependency review
echo ""
echo "--- Checking GitHub Actions dependency review ---"
if [ -f .github/workflows/security.yml ] && grep -q "dependency-review" .github/workflows/security.yml && grep -q "deny-licenses" .github/workflows/security.yml; then
    check_pass "Security workflow runs dependency review with license gates"
else
    check_fail "Security workflow is missing dependency-review or deny-licenses"
fi

# 3u. Verify every workflow keeps a scheduled trigger
echo ""
echo "--- Checking GitHub Actions scheduled triggers ---"
MISSING_SCHEDULE=""
for file in .github/workflows/test.yml .github/workflows/security.yml .github/workflows/codeql.yml; do
    if [ -f "$file" ] && ! grep -q "schedule:" "$file"; then
        MISSING_SCHEDULE="$MISSING_SCHEDULE $file"
    fi
done
if [ -z "$MISSING_SCHEDULE" ]; then
    check_pass "All workflows keep scheduled triggers"
else
    check_fail "Workflows missing schedule:$MISSING_SCHEDULE"
fi

# 3v. Verify CI secret scan covers tracked files, provider tokens, and private keys
echo ""
echo "--- Checking GitHub Actions secret scan strength ---"
if [ -f .github/workflows/security.yml ] && grep -qE "git grep|sk_live_|BEGIN .*PRIVATE KEY" .github/workflows/security.yml; then
    check_pass "CI secret scan covers client secrets, provider tokens, and private keys"
else
    check_fail "CI secret scan must cover client secrets, provider tokens, and private keys"
fi

# 3w. Verify workflows don't download-and-execute remote scripts
echo ""
echo "--- Checking GitHub Actions shell hygiene ---"
BAD_SHELL=""
for file in .github/workflows/*.yml; do
    if [ -f "$file" ] && grep -E "(curl|wget)[^|]*\|[[:space:]]*(sh|bash)" "$file" >/dev/null 2>&1; then
        BAD_SHELL="$BAD_SHELL $file"
    fi
done
if [ -z "$BAD_SHELL" ]; then
    check_pass "Workflows do not download-and-execute remote scripts"
else
    check_fail "Workflows download-and-execute remote scripts in:$BAD_SHELL"
fi

# 3x. Verify supply-chain security job exists with audit, dep-tree check, and install-script guard
echo ""
echo "--- Checking GitHub Actions supply-chain security job ---"
if [ -f .github/workflows/security.yml ] && grep -q "supply-chain-security" .github/workflows/security.yml; then
    check_pass "Security workflow includes a supply-chain security job"
else
    check_fail "Security workflow is missing a supply-chain security job"
fi
if [ -f .github/workflows/security.yml ] && grep -q "npm audit.*--omit=dev" .github/workflows/security.yml; then
    check_pass "Supply-chain job audits production dependencies only"
else
    check_fail "Supply-chain job must audit production dependencies with --omit=dev"
fi
if [ -f .github/workflows/security.yml ] && grep -q "npm ls.*--omit=dev" .github/workflows/security.yml; then
    check_pass "Supply-chain job verifies dependency tree integrity"
else
    check_fail "Supply-chain job must verify dependency tree with npm ls"
fi
if [ -f .github/workflows/security.yml ] && grep -q "npm outdated.*--omit=dev" .github/workflows/security.yml; then
    check_pass "Supply-chain job checks for outdated dependencies"
else
    check_fail "Supply-chain job must check for outdated dependencies"
fi
if [ -f .github/workflows/security.yml ] && grep -q -- "--ignore-scripts" .github/workflows/security.yml; then
    check_pass "Supply-chain job uses --ignore-scripts to block lifecycle hooks"
else
    check_fail "Supply-chain job must use --ignore-scripts on npm ci"
fi
if [ -f .github/workflows/security.yml ] && grep -q "hasInstallScript\|hasPostinstallScript\|hasPreinstallScript" .github/workflows/security.yml; then
    check_pass "Supply-chain job checks for install scripts"
else
    check_fail "Supply-chain job must check for packages with install scripts"
fi

# 3y. Verify test workflow includes non-blocking advisory checks
echo ""
echo "--- Checking GitHub Actions dependency advisory gates ---"
if [ -f .github/workflows/test.yml ] && grep -q "audit-level=moderate" .github/workflows/test.yml; then
    check_pass "Test workflow includes moderate vulnerability advisory"
else
    check_fail "Test workflow is missing moderate vulnerability advisory"
fi
if [ -f .github/workflows/test.yml ] && grep -q "npm outdated" .github/workflows/test.yml; then
    check_pass "Test workflow includes outdated dependency advisory"
else
    check_fail "Test workflow is missing outdated dependency advisory"
fi

# 4. Check CSP configuration
# Note: style-src 'unsafe-inline' is intentional for Google Fonts
echo ""
echo "--- Checking Content Security Policy ---"
if command -v node &> /dev/null; then
    if node -e "
const j=JSON.parse(require('fs').readFileSync('vercel.json','utf8'));
const c=j.headers.find(h=>h.headers.some(h=>h.key==='Content-Security-Policy'));
if(!c) throw new Error('No CSP');
const csp=c.headers.find(h=>h.key==='Content-Security-Policy').value;
// Check script-src does NOT have unsafe-inline or unsafe-eval
const scriptMatch=csp.match(/script-src[^;]*/);
if(scriptMatch && (scriptMatch[0].includes('unsafe-inline') || scriptMatch[0].includes('unsafe-eval'))) {
    console.log('CSP script-src has unsafe directives');
    process.exit(1);
}
process.exit(0);
" 2>/dev/null; then
        check_pass "CSP script-src is secure (no unsafe-inline/eval)"
    else
        check_fail "CSP script-src has unsafe directives"
    fi
else
    check_warn "Node.js not available for CSP check"
fi

# 4a. Verify CSP violation reporting is wired to the report endpoint
echo ""
echo "--- Checking CSP report-uri ---"
if command -v node &> /dev/null; then
    if node -e "
const j=JSON.parse(require('fs').readFileSync('vercel.json','utf8'));
const c=j.headers.find(h=>h.headers.some(h=>h.key==='Content-Security-Policy'));
if(!c) throw new Error('No CSP');
const csp=c.headers.find(h=>h.key==='Content-Security-Policy').value;
if(!/report-uri\s+\\/api\\/csp-report/.test(csp)) throw new Error('CSP report-uri is missing or miswired');
process.exit(0);
" 2>/dev/null; then
        check_pass "CSP report-uri is wired to /api/csp-report"
    else
        check_fail "CSP report-uri is missing or miswired"
    fi
else
    check_warn "Node.js not available for CSP report-uri check"
fi

# 4c. Verify the remaining high-value CSP directives are locked down
echo ""
echo "--- Checking CSP frame/object/base lockdown ---"
if command -v node &> /dev/null; then
    if node -e "
const j=JSON.parse(require('fs').readFileSync('vercel.json','utf8'));
const c=j.headers.find(h=>h.headers.some(h=>h.key==='Content-Security-Policy'));
if(!c) throw new Error('No CSP');
const csp=c.headers.find(h=>h.key==='Content-Security-Policy').value;
if(!csp.includes(\"frame-ancestors 'none'\")) throw new Error('frame-ancestors is not none');
if(!csp.includes(\"object-src 'none'\")) throw new Error('object-src is not none');
if(!csp.includes(\"base-uri 'self'\")) throw new Error('base-uri is not self');
if(!csp.includes(\"default-src 'self'\")) throw new Error('default-src is not self');
if(!csp.includes('upgrade-insecure-requests')) throw new Error('upgrade-insecure-requests is missing');
process.exit(0);
" 2>/dev/null; then
        check_pass "CSP frame-ancestors/object-src/base-uri/default-src are locked down"
    else
        check_fail "CSP frame-ancestors/object-src/base-uri/default-src/upgrade are not locked down"
    fi
else
    check_warn "Node.js not available for CSP directive check"
fi

# 4d. Verify production HTML has no inline event-handler attributes
echo ""
echo "--- Checking HTML inline event handlers ---"
INLINE_HANDLER=""
for page in *.html; do
    if [ -f "$page" ] && grep -Eqn '\son(click|change|input|submit|keydown|keyup|load|error|focus|blur|mouseover|mouseout|mousemove)=' "$page"; then
        INLINE_HANDLER="$INLINE_HANDLER $page"
    fi
done
if [ -z "$INLINE_HANDLER" ]; then
    check_pass "No inline event handlers in production HTML"
else
    check_fail "Inline event handlers found in:$INLINE_HANDLER"
fi

# 4e. Verify production HTML has no inline script blocks
echo ""
echo "--- Checking HTML inline scripts ---"
INLINE_SCRIPT=""
for page in *.html; do
    if [ -f "$page" ] && grep -E '<script[^>]*>' "$page" 2>/dev/null | grep -v 'src=' | grep -v 'application/ld+json' | grep -q .; then
        INLINE_SCRIPT="$INLINE_SCRIPT $page"
    fi
done
if [ -z "$INLINE_SCRIPT" ]; then
    check_pass "No inline scripts in production HTML"
else
    check_fail "Inline script blocks found in:$INLINE_SCRIPT"
fi

# 4e2. Verify target=_blank links always carry rel=noopener noreferrer
echo ""
echo "--- Checking HTML/JS reverse-tabnabbing protection ---"
UNSAFE_BLANK=""
for f in *.html assets/app.js; do
    if [ -f "$f" ] && grep -n 'target="_blank"' "$f" 2>/dev/null | grep -v 'rel="noopener noreferrer"' | grep -q .; then
        UNSAFE_BLANK="$UNSAFE_BLANK $f"
    fi
done
if [ -z "$UNSAFE_BLANK" ]; then
    check_pass "target=_blank links include noopener noreferrer"
else
    check_fail "target=_blank without rel=noopener noreferrer in:$UNSAFE_BLANK"
fi

# 4f. Verify CSP connect-src has no wildcards
echo ""
echo "--- Checking CSP connect-src wildcards ---"
if command -v node &> /dev/null; then
    if node -e "
const j=JSON.parse(require('fs').readFileSync('vercel.json','utf8'));
const c=j.headers.find(h=>h.headers.some(h=>h.key==='Content-Security-Policy'));
if(!c) throw new Error('No CSP');
const csp=c.headers.find(h=>h.key==='Content-Security-Policy').value;
const m=csp.match(/connect-src[^;]*/);
if(!m) throw new Error('No connect-src');
if(/[*]/.test(m[0])) throw new Error('connect-src contains a wildcard');
const sm=csp.match(/script-src[^;]*/);
if(!sm) throw new Error('No script-src');
if(/[*]/.test(sm[0])) throw new Error('script-src contains a wildcard');
process.exit(0);
" 2>/dev/null; then
        check_pass "CSP connect-src/script-src have no wildcards"
    else
        check_fail "CSP connect-src/script-src contains a wildcard or is missing"
    fi
else
    check_warn "Node.js not available for CSP connect-src check"
fi

# 4f2. Verify the API CSP is fully locked down (default-src none + no framing)
echo ""
echo "--- Checking CSP API lockdown ---"
if command -v node &> /dev/null; then
    if node -e "
const j=JSON.parse(require('fs').readFileSync('vercel.json','utf8'));
const block=j.headers.find(h=>h.source==='/api/(.*)');
if(!block) throw new Error('No API header block');
const csp=(block.headers.find(h=>h.key==='Content-Security-Policy')||{}).value||'';
if(!csp.includes(\"default-src 'none'\")) throw new Error('API CSP default-src is not none');
if(!csp.includes(\"frame-ancestors 'none'\")) throw new Error('API CSP frame-ancestors is not none');
process.exit(0);
" 2>/dev/null; then
        check_pass "API CSP locks default-src and frame-ancestors to none"
    else
        check_fail "API CSP is missing default-src 'none' or frame-ancestors 'none'"
    fi
else
    check_warn "Node.js not available for API CSP lockdown check"
fi

# 4g. Verify API security headers
echo ""
echo "--- Checking API security headers ---"
if command -v node &> /dev/null; then
    if node -e "
const j=JSON.parse(require('fs').readFileSync('vercel.json','utf8'));
const block=j.headers.find(h=>h.source==='/api/(.*)');
if(!block) throw new Error('No API header block');
const hs=Object.fromEntries(block.headers.map(h=>[h.key.toLowerCase(), h.value]));
const required={
  'cache-control':'no-store',
  'x-content-type-options':'nosniff',
  'x-dns-prefetch-control':'off',
  'x-download-options':'noopen',
  'x-frame-options':'DENY',
  'referrer-policy':'no-referrer',
  'strict-transport-security':'max-age=63072000; includesubdomains; preload',
  'permissions-policy':'camera=(), microphone=(), geolocation=(), interest-cohort=(), payment=(), usb=()',
  'cross-origin-opener-policy':'same-origin',
  'cross-origin-resource-policy':'same-origin',
  'x-permitted-cross-domain-policies':'none',
  'x-robots-tag':'noindex, nofollow'
};
for (const [k,v] of Object.entries(required)) {
  if((hs[k]||'').toLowerCase()!==v.toLowerCase()) throw new Error('Missing '+k+': '+v);
}
process.exit(0);
" 2>/dev/null; then
        check_pass "API security headers are strict"
    else
        check_fail "API security headers are missing or incorrect"
    fi
else
    check_warn "Node.js not available for API header check"
fi

# 4h. Verify page-level security headers
echo ""
echo "--- Checking page security headers ---"
if command -v node &> /dev/null; then
    if node -e "
const j=JSON.parse(require('fs').readFileSync('vercel.json','utf8'));
const block=j.headers.find(h=>h.source==='/(.*)');
if(!block) throw new Error('No page header block');
const hs=Object.fromEntries(block.headers.map(h=>[h.key.toLowerCase(), h.value]));
const required={
  'x-content-type-options':'nosniff',
  'x-frame-options':'SAMEORIGIN',
  'referrer-policy':'strict-origin-when-cross-origin',
  'x-dns-prefetch-control':'off',
  'x-download-options':'noopen',
  'x-permitted-cross-domain-policies':'none',
  'permissions-policy':'camera=(), microphone=(), geolocation=(), interest-cohort=(), payment=(), usb=()',
  'strict-transport-security':'max-age=63072000; includesubdomains; preload',
  'cross-origin-opener-policy':'same-origin',
  'cross-origin-resource-policy':'same-origin'
};
for (const [k,v] of Object.entries(required)) {
  if((hs[k]||'').toLowerCase()!==v.toLowerCase()) throw new Error('Missing '+k+': '+v);
}
process.exit(0);
" 2>/dev/null; then
        check_pass "Page security headers are strict"
    else
        check_fail "Page security headers are missing or incorrect"
    fi
else
    check_warn "Node.js not available for page header check"
fi

# 5. Check security.txt exists
echo ""
echo "--- Checking security.txt ---"
if [ -f ".well-known/security.txt" ]; then
    check_pass "security.txt exists"
    # Check for Expires header (required by RFC 9116)
    if grep -q "^Expires:" .well-known/security.txt 2>/dev/null; then
        check_pass "security.txt has Expires header"
    else
        check_warn "security.txt missing Expires header (RFC 9116 requirement)"
    fi
    if command -v node &> /dev/null; then
        if node -e "
const fs=require('fs');
const txt=fs.readFileSync('.well-known/security.txt','utf8');
const line=txt.split(/\r?\n/).find(l=>/^Expires:/i.test(l));
if(!line) process.exit(1);
const date=new Date(line.replace(/^Expires:\s*/i,''));
if(isNaN(date.getTime()) || date.getTime() <= Date.now()) process.exit(1);
process.exit(0);
" 2>/dev/null; then
            check_pass "security.txt Expires is in the future"
        else
            check_fail "security.txt Expires is missing or expired"
        fi
    else
        check_warn "Node.js not available for security.txt expiry check"
    fi
    # Check for Contact header (also required by RFC 9116)
    if grep -q "^Contact:" .well-known/security.txt 2>/dev/null; then
        check_pass "security.txt has Contact header"
    else
        check_fail "security.txt missing Contact header (RFC 9116 requirement)"
    fi
    # Check Vercel routes the well-known file directly
    if command -v node &> /dev/null; then
        if node -e "
const j=JSON.parse(require('fs').readFileSync('vercel.json','utf8'));
if(!(j.rewrites||[]).some(r=>r.source==='/.well-known/security.txt')) process.exit(1);
process.exit(0);
" 2>/dev/null; then
            check_pass "vercel.json rewrites security.txt"
        else
            check_fail "vercel.json does not rewrite security.txt"
        fi
    else
        check_warn "Node.js not available for security.txt rewrite check"
    fi
    if grep -q "^Canonical:" .well-known/security.txt 2>/dev/null && grep -q "^Preferred-Languages:" .well-known/security.txt 2>/dev/null; then
        check_pass "security.txt has canonical and language directives"
    else
        check_fail "security.txt is missing canonical or preferred-language directive"
    fi
    if grep -q "^Preferred-Languages: en$" .well-known/security.txt 2>/dev/null; then
        check_pass "security.txt declares English as the preferred language"
    else
        check_fail "security.txt is missing Preferred-Languages: en"
    fi
    if grep -q "^Policy: https://cleardoc.app/SECURITY.md" .well-known/security.txt 2>/dev/null; then
        check_pass "security.txt points to SECURITY.md policy"
    else
        check_fail "security.txt is missing or has an incorrect policy URL"
    fi
else
    check_fail "security.txt not found"
fi

# 6. Verify SECURITY.md exists
echo ""
echo "--- Checking SECURITY.md ---"
if [ -f "SECURITY.md" ]; then
    check_pass "SECURITY.md exists"
    if grep -q "Supported Versions" SECURITY.md 2>/dev/null; then
        check_pass "SECURITY.md declares supported versions"
    else
        check_fail "SECURITY.md is missing the supported versions section"
    fi
    if grep -q "Response Commitments" SECURITY.md 2>/dev/null; then
        check_pass "SECURITY.md documents response commitments"
    else
        check_fail "SECURITY.md is missing response commitments"
    fi
    if grep -q "Acknowledgments" SECURITY.md 2>/dev/null; then
        check_pass "SECURITY.md documents reporter acknowledgments"
    else
        check_fail "SECURITY.md is missing reporter acknowledgments"
    fi
    if grep -qi "coordinated disclosure" SECURITY.md 2>/dev/null; then
        check_pass "SECURITY.md follows coordinated disclosure"
    else
        check_fail "SECURITY.md is missing coordinated disclosure"
    fi
    if grep -q "^### Privacy" SECURITY.md 2>/dev/null; then
        check_pass "SECURITY.md documents the privacy posture"
    else
        check_fail "SECURITY.md is missing the privacy section"
    fi
    if grep -q "^### Third-Party Dependencies" SECURITY.md 2>/dev/null; then
        check_pass "SECURITY.md documents third-party dependencies"
    else
        check_fail "SECURITY.md is missing third-party dependencies section"
    fi
    if grep -q "^## Reporting a Vulnerability" SECURITY.md 2>/dev/null; then
        check_pass "SECURITY.md includes a reporting-vulnerability section"
    else
        check_fail "SECURITY.md is missing the reporting-vulnerability section"
    fi
    if grep -q "^## Security Posture" SECURITY.md 2>/dev/null; then
        check_pass "SECURITY.md documents the security posture"
    else
        check_fail "SECURITY.md is missing the security posture section"
    fi
    if grep -q "^### Transport & Headers" SECURITY.md 2>/dev/null; then
        check_pass "SECURITY.md documents transport and header security"
    else
        check_fail "SECURITY.md is missing the transport and headers section"
    fi
    if grep -Eq "security@cleardoc\.app|/security/advisories/new" SECURITY.md 2>/dev/null; then
        check_pass "SECURITY.md includes a vulnerability reporting channel"
    else
        check_fail "SECURITY.md has no vulnerability reporting channel"
    fi
    if grep -q "/security/advisories/new" SECURITY.md 2>/dev/null; then
        check_pass "SECURITY.md includes private vulnerability reporting URL"
    else
        check_fail "SECURITY.md is missing private vulnerability reporting URL"
    fi
    if grep -q "security@cleardoc\.app" SECURITY.md 2>/dev/null; then
        check_pass "SECURITY.md includes the security email"
    else
        check_fail "SECURITY.md is missing the security email"
    fi
else
    check_fail "SECURITY.md not found"
fi

# 7. Check for CODEOWNERS
echo ""
echo "--- Checking CODEOWNERS ---"
if [ -f ".github/CODEOWNERS" ]; then
    check_pass "CODEOWNERS exists"
    if grep -Ev '^[[:space:]]*#' .github/CODEOWNERS 2>/dev/null | grep -q '@'; then
        check_pass "CODEOWNERS declares an owner"
    else
        check_fail "CODEOWNERS has no owner assignments"
    fi
else
    check_fail "CODEOWNERS not found"
fi

# 8. Check for dependabot config
echo ""
echo "--- Checking dependabot.yml ---"
if [ -f ".github/dependabot.yml" ]; then
    check_pass "dependabot.yml exists"
    if grep -q "^version: 2" .github/dependabot.yml 2>/dev/null; then
        check_pass "dependabot.yml uses version 2"
    else
        check_fail "dependabot.yml must use version 2"
    fi
    if grep -q 'package-ecosystem: "npm"' .github/dependabot.yml 2>/dev/null && grep -q 'package-ecosystem: "github-actions"' .github/dependabot.yml 2>/dev/null; then
        check_pass "dependabot covers npm and GitHub Actions"
    else
        check_fail "dependabot.yml is missing npm or GitHub Actions ecosystem"
    fi
    if [ "$(grep -c "open-pull-requests-limit" .github/dependabot.yml 2>/dev/null || true)" -ge 2 ]; then
        check_pass "dependabot caps open PRs for npm and GitHub Actions"
    else
        check_fail "dependabot.yml is missing open-pull-requests-limit for both ecosystems"
    fi
    if [ "$(grep -c 'interval: "weekly"' .github/dependabot.yml 2>/dev/null || true)" -ge 2 ]; then
        check_pass "dependabot schedules weekly updates for npm and GitHub Actions"
    else
        check_fail "dependabot.yml is missing a weekly schedule for both ecosystems"
    fi
    if [ "$(grep -c '\- "dependencies"' .github/dependabot.yml 2>/dev/null || true)" -ge 2 ]; then
        check_pass "dependabot labels dependency PRs for both ecosystems"
    else
        check_fail "dependabot.yml is missing dependency labels for both ecosystems"
    fi
    if grep -q "security-updates" .github/dependabot.yml 2>/dev/null; then
        check_pass "dependabot groups security updates"
    else
        check_fail "dependabot.yml is missing a security-updates group"
    fi
    if [ "$(grep -c 'prefix:' .github/dependabot.yml 2>/dev/null || true)" -ge 2 ]; then
        check_pass "dependabot uses commit-message prefixes for both ecosystems"
    else
        check_fail "dependabot.yml is missing commit-message prefixes for both ecosystems"
    fi
else
    check_fail "dependabot.yml not found"
fi

# 9. Validate vercel.json
echo ""
echo "--- Validating vercel.json ---"
if command -v node &> /dev/null; then
    if node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8'))" 2>/dev/null; then
        check_pass "vercel.json is valid JSON"
    else
        check_fail "vercel.json is not valid JSON"
    fi
    if node -e "
const j=JSON.parse(require('fs').readFileSync('vercel.json','utf8'));
if(j.cleanUrls !== true || j.trailingSlash !== false) process.exit(1);
process.exit(0);
" 2>/dev/null; then
        check_pass "vercel.json uses clean URLs without trailing slashes"
    else
        check_fail "vercel.json cleanUrls or trailingSlash is not configured as expected"
    fi
else
    check_warn "Node.js not available for JSON validation"
fi

# 9a. Verify package-lock.json is tracked for reproducible installs
echo ""
echo "--- Checking package-lock.json ---"
if git ls-files --error-unmatch package-lock.json >/dev/null 2>&1; then
    check_pass "package-lock.json is tracked"
else
    check_fail "package-lock.json is not tracked"
fi
if [ -f package-lock.json ] && grep -q '"lockfileVersion"' package-lock.json; then
    check_pass "package-lock.json carries a lockfileVersion"
else
    check_fail "package-lock.json is missing lockfileVersion"
fi

# 9b. Verify the npm precommit hook still runs the hardening script
echo ""
echo "--- Checking package.json precommit hook ---"
if command -v node &> /dev/null; then
    if node -e "
const p=require('./package.json');
const pre=p.scripts && p.scripts.precommit ? p.scripts.precommit : '';
if(!/security-hardening/.test(pre)) process.exit(1);
process.exit(0);
" 2>/dev/null; then
        check_pass "npm precommit runs the security hardening script"
    else
        check_fail "npm precommit does not run scripts/security-hardening.sh"
    fi
    if node -e "
const p=require('./package.json');
const e=p.engines && p.engines.node ? p.engines.node : '';
if(!/>=?\s*22/.test(e)) process.exit(1);
process.exit(0);
" 2>/dev/null; then
        check_pass "package.json requires Node 22 or newer"
    else
        check_fail "package.json engines.node must be 22 or newer"
    fi
    if node -e "
const p=require('./package.json');
const t=p.scripts && p.scripts.test ? p.scripts.test : '';
if(!/test:unit/.test(t) || !/test:smoke/.test(t) || !/test:integration/.test(t)) process.exit(1);
process.exit(0);
" 2>/dev/null; then
        check_pass "npm test runs unit, smoke, and integration suites"
    else
        check_fail "package.json test script must run unit, smoke, and integration suites"
    fi
    if node -e "
const p=require('./package.json');
if(p.private !== true) process.exit(1);
process.exit(0);
" 2>/dev/null; then
        check_pass "package.json is marked private"
    else
        check_fail "package.json must be private (prevent accidental publish)"
    fi
else
    check_warn "Node.js not available for package.json checks"
fi

# 9c. Verify package.json has no install lifecycle scripts
echo ""
echo "--- Checking package.json install lifecycle scripts ---"
if command -v node &> /dev/null; then
    if node -e "
const p=require('./package.json');
const bad=['preinstall','install','postinstall'].filter(k=>p.scripts && Object.prototype.hasOwnProperty.call(p.scripts,k));
if(bad.length) { console.log('Lifecycle scripts found: '+bad.join(', ')); process.exit(1); }
process.exit(0);
" 2>/dev/null; then
        check_pass "package.json has no preinstall/install/postinstall scripts"
    else
        check_fail "package.json must not define install lifecycle scripts"
    fi
else
    check_warn "Node.js not available for lifecycle script check"
fi

# 10. Check no tracked .env secret files
echo ""
echo "--- Checking tracked env files ---"
tracked_env=$(git ls-files 2>/dev/null | grep -E '(^|/)(\.env|\.env\.)' | grep -v '\.env\.example$' || true)
if [ -n "$tracked_env" ]; then
    check_fail "Tracked env files may leak secrets:"
    echo "$tracked_env"
else
    check_pass "No tracked env secret files"
fi

# 11. Verify robots.txt disallows /api/
echo ""
echo "--- Checking robots.txt API exclusion ---"
if [ -f "robots.txt" ] && grep -q "^Disallow: /api/$" robots.txt 2>/dev/null; then
    check_pass "robots.txt disallows /api/"
else
    check_fail "robots.txt must disallow /api/"
fi

# 11b. Verify robots.txt has standard user-agent and sitemap directives
echo ""
echo "--- Checking robots.txt standard directives ---"
if [ -f "robots.txt" ] && grep -q "^User-agent:" robots.txt 2>/dev/null && grep -q "^Sitemap:" robots.txt 2>/dev/null; then
    check_pass "robots.txt has user-agent and sitemap directives"
else
    check_fail "robots.txt is missing user-agent or sitemap directive"
fi
if [ -f "robots.txt" ] && grep -q "^User-agent: \*$" robots.txt 2>/dev/null; then
    check_pass "robots.txt targets all crawlers"
else
    check_fail "robots.txt is missing User-agent: *"
fi
if [ -f "robots.txt" ] && grep -q "^Allow: /$" robots.txt 2>/dev/null; then
    check_pass "robots.txt allows the site root"
else
    check_fail "robots.txt is missing Allow: /"
fi
if [ -f "robots.txt" ] && grep -q "^Sitemap: https://cleardoc.app/sitemap.xml$" robots.txt 2>/dev/null; then
    check_pass "robots.txt points to the canonical sitemap URL"
else
    check_fail "robots.txt sitemap URL is missing or incorrect"
fi

# 12. Verify sitemap.xml contains the core URLs
echo ""
echo "--- Checking sitemap.xml core URLs ---"
if [ -f "sitemap.xml" ]; then
    missing=""
    for url in "https://cleardoc.app/" "https://cleardoc.app/analyze.html" "https://cleardoc.app/pricing.html"; do
        if ! grep -q "<loc>$url</loc>" sitemap.xml 2>/dev/null; then
            missing="$missing $url"
        fi
    done
    if [ -z "$missing" ]; then
        check_pass "sitemap.xml contains core URLs"
    else
        check_fail "sitemap.xml missing:$missing"
    fi
    if grep -q "<lastmod>" sitemap.xml 2>/dev/null; then
        check_pass "sitemap.xml contains lastmod entries"
    else
        check_fail "sitemap.xml is missing lastmod entries"
    fi
    if grep -q "<changefreq>" sitemap.xml 2>/dev/null; then
        check_pass "sitemap.xml contains changefreq entries"
    else
        check_fail "sitemap.xml is missing changefreq entries"
    fi
    if grep -q "<priority>" sitemap.xml 2>/dev/null; then
        check_pass "sitemap.xml contains priority entries"
    else
        check_fail "sitemap.xml is missing priority entries"
    fi
else
    check_fail "sitemap.xml not found"
fi

# 13. Verify test servers bind to loopback only
echo ""
echo "--- Checking test server loopback binding ---"
if [ -f "test/smoke.test.js" ] && grep -q "const HOST = \"127.0.0.1\"" test/smoke.test.js && grep -q "server.listen(PORT, HOST)" test/smoke.test.js; then
    check_pass "Smoke test server binds to loopback only"
else
    check_fail "Smoke test server must bind to 127.0.0.1 (never 0.0.0.0)"
fi
if [ -f "test/integration.test.js" ] && grep -q "const HOST = \"127.0.0.1\"" test/integration.test.js && ! grep -n '\.listen(' test/integration.test.js | grep -v 'HOST' | grep -q .; then
    check_pass "Integration test servers bind to loopback only"
else
    check_fail "Integration test servers must bind to 127.0.0.1"
fi

# Summary
echo ""
echo "=== Summary ==="
echo -e "Passed: ${GREEN}$PASS${NC}"
echo -e "Failed: ${RED}$FAIL${NC}"

if [ $FAIL -gt 0 ]; then
    echo ""
    echo -e "${RED}Some security checks failed. Please review and fix the issues above.${NC}"
    exit 1
else
    echo ""
    echo -e "${GREEN}All security checks passed!${NC}"
    exit 0
fi
