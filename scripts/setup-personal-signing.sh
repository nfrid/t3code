#!/bin/bash
set -euo pipefail
umask 077

if [[ "$(uname -s)" != Darwin ]]; then
  echo "Run this once on the Mac that will install the personal builds." >&2
  exit 1
fi

signing_dir="${XDG_CONFIG_HOME:-$HOME/.config}/t3code-personal-signing"
mkdir -p "$signing_dir"
chmod 700 "$signing_dir"

if [[ ! -f "$signing_dir/identity.p12" ]]; then
  staging_dir=$(mktemp -d "$signing_dir/setup.XXXXXX")
  trap 'rm -rf "$staging_dir"' EXIT
  cat > "$staging_dir/openssl.cnf" <<'EOF'
[req]
distinguished_name=dn
x509_extensions=ext
prompt=no
[dn]
CN=T3 Code Personal
[ext]
basicConstraints=critical,CA:TRUE
keyUsage=critical,digitalSignature,keyCertSign
extendedKeyUsage=codeSigning
EOF
  /usr/bin/openssl rand -hex 32 > "$staging_dir/password"
  /usr/bin/openssl req -x509 -newkey rsa:3072 -nodes -sha256 -days 10950 \
    -keyout "$staging_dir/key.pem" -out "$staging_dir/certificate.pem" \
    -config "$staging_dir/openssl.cnf" 2> "$staging_dir/generation.log"
  /usr/bin/openssl pkcs12 -export -out "$staging_dir/identity.p12" \
    -inkey "$staging_dir/key.pem" -in "$staging_dir/certificate.pem" \
    -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 \
    -passout "file:$staging_dir/password"
  cp "$staging_dir/password" "$signing_dir/password"
  cp "$staging_dir/certificate.pem" "$signing_dir/certificate.pem"
  mv "$staging_dir/identity.p12" "$signing_dir/identity.p12"
fi

/usr/bin/openssl pkcs12 -in "$signing_dir/identity.p12" \
  -passin "file:$signing_dir/password" -nokeys -out /dev/null
echo "Signing certificate:"
/usr/bin/openssl x509 -in "$signing_dir/certificate.pem" -noout -subject -fingerprint -sha256

keychain=$(security default-keychain -d user | sed -E 's/^[[:space:]]*"(.*)"$/\1/')
echo "Authorizing this certificate for code signing only; macOS may ask for confirmation."
security add-trusted-cert -r trustRoot -p codeSign -k "$keychain" "$signing_dir/certificate.pem"
echo "Ready. Keep a private backup of $signing_dir; future releases must use the same certificate."
