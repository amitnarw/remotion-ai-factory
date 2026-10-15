/**
 * WhatIfDemo — hardcoded demo composition for Remotion Studio preview
 * using the gravity spec.
 */
import { WhatIfVideo } from "./index";
import { validateSpec } from "../../generator/spec.schema";
import gravitySpec from "../../generator/spec.example.gravity.json";

const spec = validateSpec(gravitySpec);

export const WhatIfDemo = () => <WhatIfVideo spec={spec} />;
