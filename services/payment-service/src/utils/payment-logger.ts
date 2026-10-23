/**
 * Tiny structured logger for the payment module (one JSON object per line).
 * It only depends on console so it works today; swap the body for pino/winston
 * when the project's structured-logging phase lands. NEVER pass secrets, card
 * data, signatures or full webhook bodies in `fields` - ids and amounts only.
 */
type Fields = Record<string, unknown>;

function emit(
    level: "info" | "warn" | "error",
    event: string,
    fields: Fields
): void {
    const line = JSON.stringify({
        ts: new Date().toISOString(),
        level,
        scope: "payment",
        event,
        ...fields,
    });

    if (level === "error") {
        console.error(line);
    } else if (level === "warn") {
        console.warn(line);
    } else {
        console.info(line);
    }
}

export const paymentLog = {
    info: (event: string, fields: Fields = {}): void => emit("info", event, fields),
    warn: (event: string, fields: Fields = {}): void => emit("warn", event, fields),
    error: (event: string, fields: Fields = {}): void => emit("error", event, fields),
};
