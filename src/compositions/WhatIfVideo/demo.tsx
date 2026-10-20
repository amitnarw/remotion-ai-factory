/**
 * WhatIfDemo — hardcoded demo composition for Remotion Studio preview
 * using the eyesight template (street-block reference look).
 */
import { WhatIfVideo } from "./index";
import { validateSpec } from "../../generator/spec.schema";
import eyesightSpec from "../../generator/spec.example.eyesight.json";

const spec = validateSpec(eyesightSpec);

export const WhatIfDemo = () => <WhatIfVideo spec={spec} />;
