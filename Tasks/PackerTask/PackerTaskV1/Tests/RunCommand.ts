// Shared "task under test" entry for command mock-runner suites.
//
// This file used to RE-IMPLEMENT src/index.ts (construct a ParentCommandHandler,
// execute(provider, command), setResult) rather than run it. Every scenario in
// this suite therefore exercised a copy of the entry point while the real one --
// the file task.json's `execution` handlers actually point the ADO agent at --
// was loaded by nothing and excluded from the coverage metric (#189). A
// regression in index.ts (a dropped signal registration, a changed input name,
// a load-time crash) passed CI untouched.
//
// It now delegates to the real entry point: requiring it runs its `void run()`
// under the mock task-lib the TaskMockRunner has already installed, so all 30+
// scenarios below drive src/index.ts -> parent-handler -> provider handler ->
// tool for real. index.js is correspondingly no longer excluded in .nycrc.json.
// EntryPointSignalsL0.ts covers the one part this path cannot reach: the
// SIGTERM/SIGINT/uncaughtException/unhandledRejection listeners it registers.
import '../src/index';
