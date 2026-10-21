# Dağıtım topolojisi: port ve erişim matrisi

Şema: README §2, Dağıtım topolojisi. Etkileşimli 3D sürümü: `topology/dist/tourvisio-topology.html`

Gateway bugün internete kapalıdır. Mobil/B2B açıldığında yalnız `api.gidiyorum.com` rotası Traefik üzerinden açılır.

| Yüzey | Kim erişir | Kısıt |
|---|---|---|
| Traefik `:443` | Herkes, Cloudflare üzerinden | Origin yalnız Cloudflare IP aralıklarına açık (firewall + Authenticated Origin Pulls). WAF ve bot kuralları Cloudflare'de. |
| Next.js `:3000` | Tarayıcılar, Traefik arkasında | Port dışarı yayınlanmaz, yalnız Traefik route'u. |
| flight-gateway `:3000` | Next.js (iç overlay) | İnternete kapalı, port yayını yok. Her istek JWT ister (`/auth/token` ve `/health/*` hariç). Next.js ile arası şifreli overlay ağ (`docker network create --opt encrypted`, IPsec). |
| `api.gidiyorum.com` (mobil, B2B, ileride) | Mobil ve B2B client'lar | Cloudflare → Traefik → gateway, ayrı route. Client credentials, IP allowlist, ayrı kota. |
| Redis cache örneği `:6379` | Yalnız gateway | İç ağ, TLS + parola. `allkeys-lru`. `sr`, `sq`, `loc`, `fr`. Kaybı `410` + `/refresh` ile telafi edilir. |
| Redis durum örneği `:6380` | Yalnız gateway | İç ağ, TLS + parola. `noeviction`. `sid` (küçük kayıt, tahliye edilmez), token, kilit, rate limit, `jti` deny-list, BullMQ. |
| Sentinel `:26379` | Gateway ve Redis düğümleri | İç ağ. 3 sentinel 3 node'a yayılır, iki örneği de izler. |
| PostgreSQL `:5432` | Gateway ve migration işi | İç ağ, uygulama rolü en az yetkili. Günlük yedek + PITR. |
| OTel collector `:4317` | Yalnız gateway | İç ağ. SigNoz arayüzü VPN / Cloudflare Access arkasında. |
| Infisical | Servisler (machine identity), ekip (SSO) | Infisical Cloud (Swarm dışı) ya da ayrı bir host, Swarm node'larıyla aynı yerde değil. Servis yalnız kendi ortamının projesini okur. |
| Dokploy paneli | Operatör | VPN veya Cloudflare Access arkasında, herkese açık değil. |
| Swarm düğüm portları: `2377/tcp`, `7946/tcp+udp`, `4789/udp`, ESP (IP protokol 50) | 3 node birbirine | Firewall ile yalnız node IP'leri arasında. ESP, şifreli overlay ağın IPsec trafiği için gerekir. |
| Çıkış, TourVisio `:443` | Yalnız gateway | Sabit egress IP üzerinden, TourVisio IP beyaz listesinde. |
