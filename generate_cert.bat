@echo off
echo Generating SSL certificates for dev.chatbot24.ai...

set OPENSSL_CONF=config.cnf

echo [dn] > config.cnf
echo CN=dev.chatbot24.ai >> config.cnf
echo [req] >> config.cnf
echo distinguished_name = dn >> config.cnf
echo [EXT] >> config.cnf
echo subjectAltName=DNS:dev.chatbot24.ai >> config.cnf
echo keyUsage=digitalSignature >> config.cnf
echo extendedKeyUsage=serverAuth >> config.cnf

openssl req -x509 -out localhost.pem -keyout localhost-key.pem -newkey rsa:2048 -nodes -sha256 -subj "/CN=dev.chatbot24.ai" -extensions EXT -config config.cnf

del config.cnf
echo Certificates generated: localhost.pem and localhost-key.pem