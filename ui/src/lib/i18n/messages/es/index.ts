import part0 from "./activity";
import part1 from "./activity-2";
import approvals from "./approvals";
import part2 from "./common";
import part3 from "./common-2";
import part4 from "./common-3";
import part5 from "./common-4";
import part6 from "./composer";
import part7 from "./composer-2";
import context from "./context";
import dictionary from "./dictionary";
import part17 from "./editor";
import part18 from "./editor-2";
import part19 from "./editor-3";
import hooks from "./hooks";
import marketplace from "./marketplace";
import modules from "./modules";
import part13 from "./providers";
import part14 from "./providers-2";
import part15 from "./providers-3";
import part16 from "./providers-4";
import part8 from "./settings";
import part9 from "./settings-2";
import part10 from "./settings-3";
import part11 from "./settings-4";
import part12 from "./tasks";
import tools from "./tools";
import twin from "./twin";
import twinCorrection from "./twin-correction";

import vision from "./vision";

export default {
  ...twin,
  ...twinCorrection,
  ...dictionary,
  ...approvals,
  ...hooks,
  ...vision,
  ...modules,
  ...marketplace,
  ...tools,
  ...context,
  ...part0,
  ...part1,
  ...part2,
  ...part3,
  ...part4,
  ...part5,
  ...part6,
  ...part7,
  ...part8,
  ...part9,
  ...part10,
  ...part11,
  ...part12,
  ...part13,
  ...part14,
  ...part15,
  ...part16,
  ...part17,
  ...part18,
  ...part19,
} as const;
