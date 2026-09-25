import { mountNetBadge, mountWallet } from "./ui";
import { localizeUtc } from "./time";
mountNetBadge(); mountWallet(); localizeUtc();
// The demo video is published separately (web/public/demo.mp4); show the player only once it exists.
fetch("/demo.mp4", { method: "HEAD" }).then((r) => { if (r.ok && /video/.test(r.headers.get("content-type") ?? "")) document.getElementById("vid")!.hidden = false; }).catch(() => {});
