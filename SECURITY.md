# Security policy

## Reporting a vulnerability

Please report security issues privately with **Report a vulnerability** on this repository's **Security** tab, or by email to [hanson.han@opus.pro](mailto:hanson.han@opus.pro). Don't open a public issue.

Include what you found, how to reproduce it and what an attacker could do with it. We'll acknowledge the report within three business days and keep you updated until it's resolved.

## Deployment model

ReelMakeEasy is a single-user app. Keep these in mind when you run it:

- **Anyone who can reach the API has full access.** There is no sign-in, token or other access control. The API and the web app listen on `127.0.0.1` unless you set `HOST`; if you do, keep them behind a firewall or an authenticating reverse proxy with TLS.
- **The Docker database has no password.** `docker-compose.yml` publishes MongoDB on `127.0.0.1` only. Turn on MongoDB authentication before making it reachable from other machines.
- **Stored media is public by URL.** `/api/files/<key>` serves the data directory's `files/` folder to anyone who can reach the API so video and image tags can load it. Keys contain project ids, which are not secret. Don't store anything there you wouldn't share with someone who has the link. Nothing outside `files/` is served: a key with a `..`, hidden or empty segment (also percent-encoded, once or twice) is refused, so is a key that leads out of `files/` through a link (the agent can write into a project's folder), and each file's metadata sits in `files-meta/`, outside the served folder.
- **Uploads use signed URLs.** The signing key is `FILE_SIGNING_SECRET`, or a random key generated into the data directory on first run. Keep that directory private.
- **Provider keys live in `.env`.** It's gitignored; keep it out of images and backups you share.
