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
else
    check_fail "security.txt not found"
fi

# 6. Verify SECURITY.md exists
echo ""
echo "--- Checking SECURITY.md ---"
if [ -f "SECURITY.md" ]; then
    check_pass "SECURITY.md exists"
else
    check_fail "SECURITY.md not found"
fi

# 7. Check for CODEOWNERS
echo ""
echo "--- Checking CODEOWNERS ---"
if [ -f ".github/CODEOWNERS" ]; then
    check_pass "CODEOWNERS exists"
else
    check_fail "CODEOWNERS not found"
fi

# 8. Check for dependabot config
echo ""
echo "--- Checking dependabot.yml ---"
if [ -f ".github/dependabot.yml" ]; then
    check_pass "dependabot.yml exists"
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
