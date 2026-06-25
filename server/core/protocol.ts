// The wire protocol lives in `src/bridge/protocol.ts` (the client's home, and a
// pure types+consts module with zero node deps). Re-export it here so server
// code keeps importing `./protocol` and the two sides can never drift.
export * from '../../src/bridge/protocol'
