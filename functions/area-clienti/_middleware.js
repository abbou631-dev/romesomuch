// The client area opens only for a signed-in client (or the agency viewing
// one); the sign-in and invite pages are always reachable.
import { signedInClient } from "../../server/sessions.js";
import { gate } from "../../server/gate.js";

export const onRequest = (context) => gate(context, ["/area-clienti/login", "/area-clienti/invito"], async (request, env) => Boolean(await signedInClient(request, env)));
