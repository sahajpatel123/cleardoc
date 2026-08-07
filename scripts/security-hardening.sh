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

# 1. Check for hardcoded secrets in source files
echo "--- Checking for hardcoded secrets ---"
if grep -rE "(api[_-]?key|secret[_-]?key)\s*=\s*['\"][^'\"]{10,}['\"]" --include="*.js" --include="*.ts" \
    --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.opencode \
    --exclude-dir=.git --exclude-dir=.claude --exclude-dir=.openclaude \
    --exclude-dir=.antigravitycli --exclude-dir=playwright-report --exclude-dir=test-results \
    . 2>/dev/null | grep -v "//"; then
    check_fail "Potential hardcoded secrets found"
else
    check_pass "No hardcoded secrets detected"
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
    if [ -f "$file" ] && ! grep -q "npm audit" "$file"; then
        MISSING_AUDIT="$MISSING_AUDIT $file"
    fi
done
if [ -z "$MISSING_AUDIT" ]; then
    check_pass "npm audit gate is present in test and security workflows"
else
    check_fail "npm audit gate missing in:$MISSING_AUDIT"
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

# 3h. Verify checkout steps do not persist credentials
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
else
    check_fail "security.txt not found"
fi

# 6. Verify SECURITY.md exists
echo ""
echo "--- Checking SECURITY.md ---"
if [ -f "SECURITY.md" ]; then
    check_pass "SECURITY.md exists"
    if grep -Eq "security@cleardoc\.app|/security/advisories/new" SECURITY.md 2>/dev/null; then
        check_pass "SECURITY.md includes a vulnerability reporting channel"
    else
        check_fail "SECURITY.md has no vulnerability reporting channel"
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
    if grep -q 'package-ecosystem: "npm"' .github/dependabot.yml 2>/dev/null && grep -q 'package-ecosystem: "github-actions"' .github/dependabot.yml 2>/dev/null; then
        check_pass "dependabot covers npm and GitHub Actions"
    else
        check_fail "dependabot.yml is missing npm or GitHub Actions ecosystem"
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
else
    check_fail "sitemap.xml not found"
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
