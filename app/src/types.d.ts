declare module "@ungap/structured-clone" { const structuredClone: <T>(value: T, options?: { lossy?: boolean; json?: boolean }) => T; export default structuredClone; }
