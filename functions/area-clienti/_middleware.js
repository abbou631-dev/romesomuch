// The client area opens only for a signed-in client (or the agency viewing
// one); login and password recovery are always reachable.
import { signedInClient } from "../../server/sessions.js";
import { gate } from "../../server/gate.js";

export const onRequest = (context) => gate(context, ["/area-clienti/login", "/area-clienti/password-dimenticata", "/area-clienti/nuova-password"], async (request, env) => Boolean(await signedInClient(request, env)));
