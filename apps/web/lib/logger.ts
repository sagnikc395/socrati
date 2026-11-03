type LogFields = Record<string, unknown>;

function sanitize(fields?: LogFields): LogFields | undefined {
    if (!fields) return undefined;

    return Object.fromEntries(
        Object.entries(fields).map(([key, value]) => {
            if (/token|key|secret|password/i.test(key)) {
                return [key, '[redacted]'];
            }

            return [key, value];
        }),
    );
}

function writeEvent(scope: string, message: string, fields?: LogFields) {
    const payload = sanitize({ ...fields });
    if (payload && Object.keys(payload).length > 0) {
        console.log(`[${scope}] ${message}`, payload);
        return;
    }

    console.log(`[${scope}] ${message}`);
}

function writeError(scope: string, message: string, errorOrFields?: unknown, extraFields?: LogFields) {
    // Two shapes: error(err, fields?) or error(fields?) for non-Error failures
    const err = errorOrFields instanceof Error ? errorOrFields : undefined;
    const fields = err ? extraFields : (errorOrFields as LogFields | undefined);

    const errorFields = err
        ? { errorName: err.name, errorMessage: err.message, errorStack: err.stack }
        : {};

    const payload = sanitize({ ...extraFields, ...fields, ...errorFields });
    if (payload && Object.keys(payload).length > 0) {
        console.error(`[${scope}] ${message}`, payload);
        return;
    }

    console.error(`[${scope}] ${message}`);
}

// bind() attaches requestId/jobId to every line from the returned logger
function bind(bound: LogFields) {
    return {
        event: (scope: string, message: string, fields?: LogFields) =>
            writeEvent(scope, message, { ...bound, ...fields }),
        error: (scope: string, message: string, errorOrFields?: unknown, fields?: LogFields) =>
            writeError(scope, message, errorOrFields, { ...bound, ...fields }),
    };
}

/** One logger for the app; `scope` is the namespace ([redis], [worker], [chat]). */
export const log = { event: writeEvent, error: writeError, bind };
