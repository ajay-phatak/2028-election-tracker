// /2026/* -> the archived 2026 tracker. See src/config/archive.config.js.
import { archiveFor } from "../../src/config/archive.config.js";
import { proxyArchive } from "../../src/lib/archiveProxy.js";

const entry = archiveFor(2026);

export const onRequest = ({ request }) => proxyArchive(request, { prefix: entry.path, origin: entry.origin });
