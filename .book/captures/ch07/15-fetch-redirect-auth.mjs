import http from "node:http"
const b = http.createServer((req, res) => { res.end(JSON.stringify({ auth: req.headers.authorization ?? null })) }).listen(18082)
const a = http.createServer((req, res) => { res.writeHead(307, { location: "http://127.0.0.1:18082/data" }); res.end() }).listen(18081)
const r = await fetch("http://127.0.0.1:18081/x", { headers: { authorization: "Bearer abc" } })
console.log(r.status, await r.text())
const r2 = await fetch("http://127.0.0.1:18081/x".replace("18081","18082"), { headers: { authorization: "Bearer abc" } })
console.log("same-origin direct:", await r2.text())
a.close(); b.close()
# output: 200 {"auth":null} / same-origin direct: {"auth":"Bearer abc"}
