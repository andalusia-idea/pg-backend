# TLS for internal TCP microservices

Applies to the TCP calls between `auth`, `config`, `transaction`, `settlerecon` (`libs/microservice`). Written up after checking the real deploy topology (single-node K3s cluster, see `k8s/*.yaml` + `.github/workflows/ci-cd.yml`) and verifying the mechanics below with real openssl/Node runs — not just from docs.

## What TLS actually does

Plain TCP moves bytes reliably and in order, but in cleartext — anything that can see the wire can read every byte, and anyone can pretend to be either endpoint. TLS sits on top of TCP and adds three guarantees:

1. **Confidentiality** — the bytes on the wire are encrypted; only the two endpoints can read them.
2. **Integrity** — if a byte is tampered with in transit, the receiver detects it and drops the connection instead of accepting corrupted/injected data.
3. **Authentication** — each side can cryptographically prove its identity via a certificate, so you're not silently talking to an impersonator.

## The handshake, in plain terms

1. Client opens the TCP connection, sends a `ClientHello` (proposes a TLS version + cipher suites + a random number).
2. Server replies with a `ServerHello` (picks a cipher suite, sends its own random number) and its **certificate** (its public key + identity, signed by a CA).
3. Client checks the certificate: signed by a CA I trust? Hostname matches? Not expired?
4. Both sides run a key exchange (modern TLS uses ECDHE — Diffie-Hellman over elliptic curves) to arrive at the same shared secret *without ever transmitting the secret itself*. Even someone who recorded the whole conversation can't compute it after the fact — this property is called forward secrecy.
5. Both sides derive a symmetric session key from that shared secret.
6. From here on, all traffic is encrypted with fast symmetric ciphers (AES-GCM / ChaCha20) using that session key.

The certificate/public-key machinery (asymmetric crypto) is only used during the handshake, because it's computationally expensive. The actual data is protected by symmetric crypto, which is cheap — on any modern server CPU it runs on dedicated AES-NI hardware instructions. This is why the earlier performance concern mostly evaporates once you know the client keeps one persistent connection per service pair (confirmed in `@nestjs/microservices`' `ClientTCP` source): the expensive handshake happens once per connection lifetime, not per request.

## Certificates and trust

A certificate is: a public key + an identity claim ("I am `config-service`") + a signature from whoever vouches for that claim.

- On the public internet, the "whoever" is a public CA (Let's Encrypt, DigiCert...) that browsers/OSes already trust.
- For **internal-only** service-to-service traffic — this case — you don't need a public CA. You create your own private CA once (a self-signed root certificate), then use it to sign one leaf certificate per service. Every service is configured to trust that private CA's root cert instead of the public trust store, so they accept each other's certs, but nothing else does.

## One-way TLS vs mutual TLS (mTLS)

- **One-way** (browser → website): only the server presents a certificate. The client verifies the server's identity; the server has no idea who the client is.
- **Mutual TLS (mTLS)**: both sides present certificates, and both sides verify. Only holders of a certificate signed by your private CA can complete a connection at all.

For this project, mTLS is the right model, not one-way. You control every participant (your own 4 services) and the goal isn't just "encrypt the wire" — it's "make sure only my real services can call `calculate_fee_purchase`," not just anything else that happens to reach that port. In Node's `tls` module: `rejectUnauthorized` defaults to `true` on the **client** side already (a client always verifies the server by default) — but on the **server** side, `requestCert` defaults to `false` (a server does *not* ask for a client certificate unless you opt in). mTLS = explicitly setting `requestCert: true` and `rejectUnauthorized: true` server-side, plus giving the server a `ca` to check client certs against.

## Generating the internal CA + service certs

Verified working end-to-end (OpenSSL 3.2.4, Node 24). One real gotcha hit while testing: a certificate needs a **Subject Alternative Name (SAN)**, not just a CN — modern Node/OpenSSL hostname verification checks the SAN extension, and a cert built without one will fail hostname verification even though it looks fine. `-copy_extensions copy` is required on the signing step, or the SAN from the CSR gets silently dropped from the final certificate.

```bash
# 1. Private CA — generate ONCE, this is your internal root of trust
openssl genrsa -out ca.key 4096
openssl req -x509 -new -nodes -key ca.key -sha256 -days 3650 \
  -subj "/CN=manapay-internal-ca" -out ca.crt

# 2. Per service (repeat for auth-service, config-service, transaction-service, settlerecon-service):
openssl genrsa -out config-service.key 2048
openssl req -new -key config-service.key -subj "/CN=config-service" \
  -addext "subjectAltName=DNS:config-service" -out config-service.csr

# 3. Your CA signs it -> the actual certificate the service presents
openssl x509 -req -in config-service.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out config-service.crt -days 825 -sha256 -copy_extensions copy
```

What each file is and where it lives:

| File | What it is | Where it goes |
|---|---|---|
| `ca.key` | CA's private key — signs new service certs | Keep offline / off the cluster. Only needed when issuing a new cert, never at runtime. |
| `ca.crt` | CA's public certificate — the root of trust | Every service (used to verify *everyone else's* cert) |
| `<service>.key` | That service's own private key | That service only, never shared |
| `<service>.crt` | That service's own certificate, signed by `ca.key` | That service only — it presents this to whoever it talks to |

The `subjectAltName=DNS:config-service` must match the `host` value your `ClientsModule` connects to for that service (e.g. the k8s Service DNS name). If it doesn't, the handshake fails with a hostname-mismatch error — confirmed below.

## Wiring into NestJS

**Client side** — `libs/microservice/src/microservice.module.ts`, add `tlsOptions` into each `useFactory`:

```ts
import { readFileSync } from 'fs';

const caCert = readFileSync('/etc/tls/ca.crt');

// ...
{
  name: CONFIG_CLIENT,
  imports: [ConfigurationModule],
  inject: [TCPConfig],
  useFactory: (tcpConfig: TCPConfig) => ({
    transport: Transport.TCP,
    options: {
      host: tcpConfig.CONFIG.HOST,
      port: tcpConfig.CONFIG.PORT,
      tlsOptions: {
        key: readFileSync('/etc/tls/transaction-service.key'),
        cert: readFileSync('/etc/tls/transaction-service.crt'),
        ca: [caCert],
      },
    },
  }),
},
```

**Server side** — each app's `main.ts` (e.g. `apps/transaction/src/main.ts`), same shape on `connectMicroservice`:

```ts
app.connectMicroservice<MicroserviceOptions>({
  transport: Transport.TCP,
  options: {
    host: tcpConfig.TRANSACTION.HOST,
    port: tcpConfig.TRANSACTION.PORT,
    tlsOptions: {
      key: readFileSync('/etc/tls/transaction-service.key'),
      cert: readFileSync('/etc/tls/transaction-service.crt'),
      ca: [caCert],
      requestCert: true, // ask the caller for a cert too
      rejectUnauthorized: true, // and require it to be signed by our CA
    },
  },
});
```

Every service gets its own `key`/`cert` pair; all of them share the same `ca.crt`. Cert paths would come from `TCPConfig` in practice, same as `HOST`/`PORT` today — shown as literal paths above just to keep the example focused on the TLS part.

## Verified test results

Ran a real `tls.createServer` (config-service's cert/key, mTLS enforced) against three real `tls.connect` attempts:

```
[valid-mTLS-client] handshake OK, authorized=true
[server] connection authorized=true, peer CN=transaction-service

[no-client-cert] handshake REJECTED: tlsv13 alert certificate required
[server] rejected a connection: peer did not return a certificate

[wrong-hostname] handshake REJECTED: Hostname/IP does not match certificate's altnames:
  Host: some-other-service. is not in the cert's altnames: DNS:config-service
```

Three things confirmed for real, not just asserted:
- A legitimate client with a CA-signed cert connects, and the server can read `getPeerCertificate().subject.CN` to know exactly *which* service just called it (`transaction-service`) — this is the access-control benefit on top of encryption.
- A client with no certificate is rejected outright once `requestCert`+`rejectUnauthorized` are set server-side — confirms mTLS is actually being enforced, not just available.
- A client presenting a valid cert but claiming the wrong hostname is rejected on a SAN mismatch — confirms hostname verification is real, not a rubber stamp.

## Practical notes for this deployment

- **Where to run this**: given the single-node K3s topology, this is real defense-in-depth but not the most urgent gap — no webhook signature verification on the 4 payment provider callbacks and disabled `@CheckPolicies` enforcement are both reachable from outside the box today; this isn't. Sequence accordingly.
- **Cert distribution**: mount `key`/`cert`/`ca.crt` the same way `app-secrets` is already injected via `secretRef` in the `k8s/*.yaml` manifests — a k8s Secret per service, or one shared Secret holding all the material.
- **`ca.key` handling**: never put the CA's private key in a running service's Secret. It's only needed to sign new certs when a service is added or a cert is rotated — keep it somewhere offline (a password manager, an encrypted local file), not in the cluster or in git.
- **Rotation**: `-days 825` above is a reasonable manual-rotation default (~2.25 years). If this grows past a handful of services, `cert-manager` (a standard k8s add-on) can automate issuance/rotation — not necessary to start with.
