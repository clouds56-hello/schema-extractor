// Re-export of dryRender to keep policy/similar.ts decoupled from the broader
// emit module. (Avoids a perceived cycle if anyone moves emitter helpers later.)
export { dryRender } from "./render"
