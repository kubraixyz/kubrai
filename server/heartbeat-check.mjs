// Runs on the app host: the Tokyo dashboard's sync pushes snapshots/tokyo-heartbeat.json every 5 min. If it goes
// stale, Tokyo (the independent verifier and the operator's console) is down, and Tokyo cannot say so itself.
import fs from "node:fs"; import path from "node:path";
import { notify } from "./notify.mjs";
const f = path.join(process.env.SNAPSHOT_DIR ?? path.join(process.cwd(), "snapshots"), "tokyo-heartbeat.json");
const MAX_MIN = Number(process.env.HEARTBEAT_MAX_MIN ?? 30);
let at = 0; try { at = JSON.parse(fs.readFileSync(f, "utf8")).at; } catch {}
const age = (Date.now() / 1000 - at) / 60;
if (age > MAX_MIN) { console.log(new Date().toISOString(), `tokyo heartbeat is ${Math.round(age)} min old`); await notify("⚠️ 東京主機沒有心跳", `東京後台/核對器已 ${Math.round(age)} 分沒回報(上限 ${MAX_MIN})。核對器停了=提案沒人獨立核對;後台看不到=先查東京機。`, "tokyo-heartbeat", 60); }
else console.log(new Date().toISOString(), `ok (${Math.round(age)} min)`);
