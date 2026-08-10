#!/usr/bin/env bash
tld="$2"; base="$3"
tr -d '"'"'\r'"'"' < "$1" | grep -v '"'"'^[[:space:]]*$'"'"' | xargs -P 8 -I{} bash -c "
  n=\"{}\"
  code=\$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 '${base}'\${n}'.${tld}')
  if [ \"\$code\" = '404' ]; then echo \"FREE   \${n}.${tld}\"; fi
"
EOF
cd "$SP"; echo "=== .io ==="; bash iocheck.sh swanreg.txt io "https://rdap.identitydigital.services/rdap/domain/" 2>/dev/null | sort | tr '\n' ' '; echo; echo "=== .co ==="; bash iocheck.sh swanreg.txt co "https://rdap.nic.co/domain/" 2>/dev/null | sort | tr '\n' ' '
