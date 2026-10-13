// The client area opens only for a signed-in client; the login page is
// always reachable.
import { signedInClient } from "../../server/sessions.js";
import { gate } from "../../server/gate.js";

export const onRequest = (context) => gate(context, "/area-clienti/login", async (request, env) => Boolean(await signedInClient(request, env)));
