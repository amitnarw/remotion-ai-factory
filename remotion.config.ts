/**
 * Note: When using the Node.JS APIs, the config file
 * doesn't apply. Instead, pass options directly to the APIs.
 *
 * All configuration options: https://remotion.dev/docs/config
 */

import { Config } from "@remotion/cli/config";
import { join } from "path";

Config.setRspack(true);
Config.setChromiumOpenGlRenderer("angle");
Config.setVideoImageFormat("jpeg");
// Not __dirname: the CLI compiles this file elsewhere, so __dirname is
// node_modules/@remotion/cli/dist and every bundle lost public/ (fonts,
// models, sounds), which made every render fail on a font 404.
Config.setPublicDir(join(process.cwd(), "public"));
