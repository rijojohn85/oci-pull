# Chapter 1: Why Build an Image Puller

## Start with something you already know

You've typed this many times:

```
$ docker pull alpine:3.20
```

and seen something like this:

```
3.20: Pulling from library/alpine
25f1d6b1951a: Pulling fs layer
25f1d6b1951a: Download complete
25f1d6b1951a: Pull complete
Digest: sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc
Status: Downloaded newer image for alpine:3.20
docker.io/library/alpine:3.20
```

Seven lines, about a second. What actually happened? Docker had a short
conversation with a server, downloaded a few files, and put them in a
folder. That's it. There is no magic in that second — just HTTP, a
checksum, and `tar`. By the end of this book you'll have written a tool
that does the same thing, and you'll have learned TypeScript on the way.

This chapter has no TypeScript in it. It's here so that when we start
writing code in Chapter 3, you already know exactly what the code is
*for*. Everything below is real: every command is one you can run from
your own terminal right now, and every output shown was captured from a
real run, not typed by hand. (Digests and version numbers will drift as
Alpine ships updates — the *shape* of each reply is what matters.)

## Where Docker went

Look at the last line of that output again:

```
docker.io/library/alpine:3.20
```

You typed `alpine:3.20`. Docker filled in the rest. `docker.io` is the
server it talked to (the address is really `registry-1.docker.io` —
Docker Hub). `library/` is the folder on that server where the official
images live. `alpine` is the image name, and `3.20` is the tag — a
human-readable label that points at one specific version. Filling in
those blanks is the very first thing our tool will do, in Chapter 3.

A server that stores and hands out images is called a **registry**. That
word will come up a lot. Docker Hub is one registry; GitHub has one
(`ghcr.io`), the cloud providers each have one, and you can run your own.
They all speak the same protocol, which is why one tool can pull from
any of them.

## Two things to know before we start

**Headers.** Every HTTP reply has two parts: the *body* (the actual
content — a JSON file, a download) and a few short labels stuck on the
front that describe the body. Those labels are called **headers**. Think
of a parcel: the goods inside, and the sticker on the box saying what's
inside and how big it is. Requests can carry headers too — that's how
a client says "here's my pass" or "here are the formats I understand."
When we use `curl` below, `-D headers.txt` saves the headers to one file
and `-o body.json` saves the body to another, so we can look at each.

**Digests.** A **digest** is a fingerprint of a file: run every byte
through a hashing function (SHA-256 here) and you get a fixed-size
number, written like `sha256:d9e853e8...`. Change one byte of the file
and the fingerprint changes completely. Two files with the same digest
are the same file. Registries use digests as *names*: you ask for a file
by its fingerprint, and when it arrives you compute the fingerprint
yourself and check it matches. If it doesn't, something was corrupted or
tampered with, and you throw it away.

That's all the vocabulary Step 3 needs. Everything else is introduced
as it comes up.

## The conversation, step by step

Docker had four short exchanges with the registry. Let's have them
ourselves, with `curl`, so nothing is hidden.

### Step 1: Ask, get told "no", get told where to ask

The registry's front door is `/v2/`. Knock on it:

```
$ curl -si https://registry-1.docker.io/v2/ | head -12
```

You should see:

```
HTTP/2 401
date: Tue, 22 Sep 2026 08:01:13 GMT
content-type: application/json
content-length: 87
docker-distribution-api-version: registry/2.0
www-authenticate: Bearer realm="https://auth.docker.io/token",service="registry.docker.io"
strict-transport-security: max-age=31536000

{"errors":[{"code":"UNAUTHORIZED","message":"authentication required","detail":null}]}
```

`401` means "you haven't proven who you are." Even for a public image,
Docker Hub wants you to hold a **token** — a short-lived pass, good for
five minutes, that says "this client is allowed to read this image." The
interesting line is `www-authenticate`. It's the registry telling you
*where to go get that pass*: the `realm` is the address, and `service` is
a value you must hand back when you ask. Our tool will read this line,
pull those two values out, and go ask. That's Chapter 5.

### Step 2: Get the token

Ask the address from the `realm`, hand back the `service`, and say which
image you want to read (`scope=repository:library/alpine:pull`):

```
$ curl -s "https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/alpine:pull" | jq '{token: (.token[0:40] + "..."), expires_in, issued_at}'
```

You should see:

```
{
  "token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsIng1...",
  "expires_in": 300,
  "issued_at": "2026-09-22T08:01:13.82153508Z"
}
```

(The real token is about a thousand characters long; it's cut short
here.) Save it in a shell variable so the next steps can use it:

```
$ TOKEN=$(curl -s "https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/alpine:pull" | jq -r .token)
```

No username, no password — for a public image the registry hands the
pass to anyone who asks. Private images need a login step before this;
that's one of the things this book leaves out, and Chapter 5 is built so
that adding it later doesn't mean rewriting anything.

### Step 3: Ask for the list of parts

An image isn't one file. It's a small JSON document that *lists* the
files, plus the files themselves. That JSON document is called the
**manifest**. Ask for it by image name and tag. The request carries two
headers of our own: `Authorization` ("here's my pass") and `Accept`
("these are the formats I understand — send one of those"):

```
$ curl -s -H "Authorization: Bearer $TOKEN" \
    -H "Accept: application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json" \
    https://registry-1.docker.io/v2/library/alpine/manifests/3.20 \
    -D headers.txt -o index.json
```

That saved the reply's headers to `headers.txt` and its body to
`index.json`. Look at two of the headers first:

```
$ grep -i -E "content-type|docker-content-digest" headers.txt
```

You should see:

```
content-type: application/vnd.oci.image.index.v1+json
docker-content-digest: sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc
```

`content-type` is the "what's in the box" sticker. The value is long,
but read it from the right: it's `json`, version `1`, and the kind of
thing is `image.index`. So the registry sent us an **index**, not a
manifest. (Had it sent a manifest, this would say `image.manifest`
instead — and this header is the only reliable way to tell which one
you got.)

`docker-content-digest` is the fingerprint of the body. Check it:

```
$ sha256sum index.json
```

```
d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc  index.json
```

Same number. And it's *exactly* the `Digest:` line `docker pull`
printed at the start of the chapter — that line was the fingerprint of
this file.

So why an index and not a manifest? Look at what came back:

```
$ jq '{mediaType, manifests: [.manifests[] | {digest: .digest[0:26], platform: (.platform.os+"/"+.platform.architecture)}]}' index.json
```

```
{
  "mediaType": "application/vnd.oci.image.index.v1+json",
  "manifests": [
    { "digest": "sha256:c64c687cbea9300178b", "platform": "linux/amd64" },
    { "digest": "sha256:37753b2965043543542", "platform": "linux/arm" },
    { "digest": "sha256:bd05c4d38cbeb5cfb34", "platform": "linux/arm" },
    { "digest": "sha256:45e09956dc667c5eff3", "platform": "linux/arm64" },
    { "digest": "sha256:4ec3ead63e75e791660", "platform": "linux/386" },
    { "digest": "sha256:80529c2d621d6271966", "platform": "linux/ppc64le" },
    { "digest": "sha256:c47cbcc0d9c7f68d8e1", "platform": "linux/riscv64" },
    { "digest": "sha256:856b20bf4946b5c8f43", "platform": "linux/s390x" }
  ]
}
```

(Trimmed with `jq` for the page; your file has more fields.) `alpine:3.20`
isn't one image — it's eight, one per kind of CPU.

Here's the difference between the two JSON files, since it matters for
the rest of the book:

- A **manifest** is the parts list for *one* image on *one* kind of
  computer: "here is the config file, and here are the layers, in
  order." Follow it and you can build the folder.
- An **index** is a list of *manifests*, one per kind of computer: "if
  you're linux/amd64 use manifest X; if you're linux/arm64 use manifest
  Y." It lists no layers itself. It only points.

```
alpine:3.20  ──►  INDEX
                   ├── linux/amd64  ──►  MANIFEST ──► config + layers
                   ├── linux/arm64  ──►  MANIFEST ──► config + layers
                   └── linux/arm    ──►  MANIFEST ──► config + layers
```

Why both exist: the same tag has to work on an Intel laptop *and* a
Raspberry Pi, but those need different binaries, so different layers,
so different manifests. The index is the one name that fans out to all
of them. Docker read the index and picked the `linux/amd64` entry
because that's what this laptop is. Our tool will do the same in
Chapter 6.

Not every image has an index. An image built for only one kind of
computer skips it — the tag points straight at a manifest. So asking
for a tag can get you either reply, and our code has to handle both
without guessing. Rule of thumb: **a manifest has `layers`; an index
has `manifests`.** If you see `layers`, you're at the end of the chain.
Handling "one of two shapes" safely turns out to be one of the most
TypeScript-specific lessons in the book.

Follow the `linux/amd64` entry. Its `digest` is the *name* of the real
manifest, so ask for it the same way, using the digest where the tag was:

```
$ AMD=$(jq -r '.manifests[] | select(.platform.os=="linux" and .platform.architecture=="amd64") | .digest' index.json)
$ curl -s -H "Authorization: Bearer $TOKEN" \
    -H "Accept: application/vnd.oci.image.manifest.v1+json" \
    https://registry-1.docker.io/v2/library/alpine/manifests/$AMD | jq .
```

You should see (annotations trimmed):

```
{
  "schemaVersion": 2,
  "mediaType": "application/vnd.oci.image.manifest.v1+json",
  "config": {
    "mediaType": "application/vnd.oci.image.config.v1+json",
    "digest": "sha256:bf8527eb54c3680e728d5b4b383a8ba730d72dae7236fbc8dff97ed6b224a731",
    "size": 612
  },
  "layers": [
    {
      "mediaType": "application/vnd.oci.image.layer.v1.tar+gzip",
      "digest": "sha256:25f1d6b1951ac8eb3740558fe94cb83d377bdadf95fd9f98b50d2e1b96130471",
      "size": 3630321
    }
  ]
}
```

*This* is the manifest. It names two kinds of thing:

- **`config`** — a small JSON file with settings: which command to run
  by default, which environment variables to set, and so on.
- **`layers`** — the actual filesystem, as one or more compressed `tar`
  files. Alpine has exactly one. A typical application image has five to
  fifteen: one for the base OS, one for the packages you installed, one
  for your code, and so on — one per `RUN`/`COPY` line in a Dockerfile,
  roughly.

Look at the layer's `digest`: `25f1d6b1951a...`. That's the ID
`docker pull` printed next to "Pulling fs layer." Now the whole
`docker pull` output reads like a transcript of this conversation.

### Step 4: Download the parts, and check them

Each thing in the manifest — the config and every layer — is called a
**blob** (just "a file of bytes the registry stores"). Every blob is
named by its digest, and you ask for it by that name:

```
$ LAYER=$(curl -s -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.oci.image.manifest.v1+json" https://registry-1.docker.io/v2/library/alpine/manifests/$AMD | jq -r '.layers[0].digest')
$ curl -sL -H "Authorization: Bearer $TOKEN" \
    https://registry-1.docker.io/v2/library/alpine/blobs/$LAYER -o layer.tar.gz
$ stat -c '%s bytes' layer.tar.gz
$ sha256sum layer.tar.gz
```

You should see:

```
3630321 bytes
25f1d6b1951ac8eb3740558fe94cb83d377bdadf95fd9f98b50d2e1b96130471  layer.tar.gz
```

The size matches the manifest's `size`. The fingerprint matches the
manifest's `digest`. That second match is the whole security story of
container images: the name of the file *is* its fingerprint, so if a
single byte were changed anywhere between the registry and your disk,
the name would no longer match and you'd refuse it. (`-L` tells curl to follow a
redirect — Docker Hub usually hands blobs off to a file-hosting service.
Our tool will need to follow that too.)

And what's inside? Just a normal compressed `tar`:

```
$ tar tzf layer.tar.gz | head -5
$ tar tzf layer.tar.gz | wc -l
```

```
bin/
bin/arch
bin/ash
bin/base64
bin/bbconfig
517
```

517 files — a whole small Linux userland. Unpack it into a folder and
that folder is Alpine.

The config blob is fetched the same way. Trimmed:

```
$ CFG=... (the config digest from the manifest)
$ curl -sL -H "Authorization: Bearer $TOKEN" https://registry-1.docker.io/v2/library/alpine/blobs/$CFG | jq '{architecture, os, config: {Cmd: .config.Cmd}}'
```

```
{
  "architecture": "amd64",
  "os": "linux",
  "config": { "Cmd": [ "/bin/sh" ] }
}
```

That `Cmd` is why `docker run alpine` drops you into a shell.

## So what *is* an image?

Strip away the words and it's this:

```
 name + tag ──► index ──► manifest ──► config      (small JSON)
   (alpine:3.20)   (per CPU)   └────► layer 1  (tar.gz)
                                └────► layer 2  (tar.gz)
                                └────► ...
```

A short chain of JSON documents, each naming the next by checksum,
ending in a stack of compressed folders. To turn it into something
`runc` can start, you unpack layer 1 into an empty folder, then unpack
layer 2 on top of it, and so on. Later layers win when a file exists in
both. And there's one small rule for deletions: if a layer contains a
file named `.wh.foo`, that means "delete `foo` from the folders below."
(There's one special spelling, `.wh..wh..opq`, that means "delete
*everything* in this folder from below.") That's the entire layering
mechanism. Chapter 9 implements it.

## What we're going to build

`oci-pull` does those four steps and then unpacks. In pieces:

| Piece | Job | Chapter |
|---|---|---|
| reference | turn `alpine:3.20` into registry + path + tag | 3 |
| http client | make one HTTP call; fakeable in tests | 4 |
| auth | read `www-authenticate`, fetch a token, retry | 5 |
| manifest | fetch JSON, check its shape, pick the CPU | 6 |
| blob store | download one blob, checksum it as it arrives, keep it | 7 |
| puller | download all blobs at once, with a limit, with retries | 8 |
| unpacker | apply layers in order into one folder | 9 |
| cli | arguments, progress, exit codes, wiring | 10 |

Each piece is small, does one job, and knows as little as possible about
the others. That isn't a style preference; it's what makes each one
testable without the internet, and it's what lets a later chapter swap
one piece (say, add password login to `auth`) without touching the rest.
We'll point at each of those decisions as we make them.

Then Chapter 11 does this:

```
$ oci-pull alpine:3.20 ./rootfs
$ runc spec
$ sudo runc run demo
/ # cat /etc/alpine-release
```

No Docker in that transcript — just our tool and the real `runc` (the
same low-level program Docker itself uses to start containers).

## Why this is a good way to learn TypeScript

Because every hard part of TypeScript shows up here for a real reason,
not a made-up one:

- The registry sends JSON. TypeScript's types are gone by the time the
  program runs, so "I declared this as a manifest" proves nothing.
  You have to *check*. That's the single most important thing to
  understand about the language, and Chapter 6 makes you live it.
- One reply can be an index *or* a manifest. TypeScript has a clean way
  to say "this value is one of these shapes, and you must look before you
  use it."
- Downloads are slow and there are many of them. That's `async`/`await`,
  running things at the same time, limiting how many, cancelling, and
  retrying — all of which you know from Go and Python, all of which look
  a bit different here.
- Tests can't hit Docker Hub. So you learn to fake the network, and then
  the clock, which is the testing skill that transfers to every
  TypeScript job.

## What you should now be able to answer

Try to answer each one in your own words first. Then open the answer to check.

**1. What are the four HTTP exchanges behind `docker pull`?**

<details>
<summary>Answer</summary>

1. **Knock on `/v2/`.** The registry answers `401` and a `www-authenticate` header saying where to get a token.
2. **Get a token** from that address (the `realm`), sending back the `service` and a `scope` naming the image.
3. **Ask for the manifest**, with the token in `Authorization` and the formats you understand in `Accept`. For a multi-CPU image this first gives you an index. You then ask again, by digest, for your CPU's manifest.
4. **Download the blobs**, the config and every layer, by their digests, and check each one's size and fingerprint.

</details>

**2. What is a registry, a manifest, an index, a blob, a layer, a digest?**

<details>
<summary>Answer</summary>

- **Registry**: a server that stores and hands out images (Docker Hub, `ghcr.io`, ...).
- **Manifest**: a small JSON parts list for *one* image on *one* kind of computer: a config and the layers, in order.
- **Index**: a JSON list of manifests, one per kind of computer. It names no layers itself; it only points.
- **Blob**: any file the registry stores, asked for by its digest.
- **Layer**: a blob that is a compressed `tar` of part of the filesystem.
- **Digest**: a fingerprint of a file's bytes (`sha256:...`). Change one byte and it changes completely.

</details>

**3. What is an HTTP header, and which two headers tell you what kind of file the registry sent and whether it arrived intact?**

<details>
<summary>Answer</summary>

A header is a short `name: value` label sent along with a request or a reply, describing it. It's the sticker on the parcel, not the goods inside. `content-type` says what kind of file the body is (index or manifest). `docker-content-digest` is the body's fingerprint. Compute `sha256` of what you received and compare.

</details>

**4. Why does a public image still need a token, and how does the client find out where to get one?**

<details>
<summary>Answer</summary>

Docker Hub wants every request to carry a token, a short-lived pass (five minutes) that says "this client may read this image". For public images it hands one to anyone who asks, without a password. The client learns where to ask from the `401` reply's `www-authenticate` header: `realm` is the token server's address, and `service` is a value to send back.

</details>

**5. Why can an image name fetch *two different shapes* of JSON?**

<details>
<summary>Answer</summary>

Because a tag can point at an **index** (the image is built for several kinds of CPU) or straight at a **manifest** (it's built for only one). The `content-type` header tells you which one arrived. Inside, a manifest has `layers` and an index has `manifests`.

</details>

**6. How does a digest protect you from a corrupted download?**

<details>
<summary>Answer</summary>

Blobs are *named* by their digest. After downloading, you compute the fingerprint of the bytes you actually got and compare it with the name you asked for. If even one byte changed on the way, the fingerprints won't match, and you throw the file away.

</details>

**7. How do layers turn into one folder, and what does `.wh.foo` mean?**

<details>
<summary>Answer</summary>

Unpack layer 1 into an empty folder, then layer 2 on top, and so on, in order. When a file exists in two layers, the later one wins. A file named `.wh.foo` in a layer means "delete `foo` from the layers below". The special name `.wh..wh..opq` means "empty this folder of everything from below".

</details>

## Next chapter

Chapter 2 sets up the project: installing Node.js and the TypeScript
compiler, the handful of compiler settings that actually matter (and why
"strict" is the one you never turn off), Vitest for tests, and one tiny
test that proves the whole pipeline works before we write anything real.
It ends with `npm run check` green and the first commit.
