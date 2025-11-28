import pino, {Logger} from 'pino'

export type LoggerOptions = {
    level?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'
    enabled?: boolean
    prettify?: boolean
}

let loggerInstance: Logger | null = null

export function createLogger(options: LoggerOptions = {}): Logger {
    const {level = 'info', enabled = true, prettify = process.env.NODE_ENV !== 'production'} = options

    if (!enabled) {
        return pino({enabled: false})
    }

    if (loggerInstance) {
        return loggerInstance
    }

    loggerInstance = pino({
        level,
        ...(prettify && {
            transport: {
                target: 'pino-pretty',
                options: {
                    colorize: true,
                    translateTime: 'HH:MM:ss.l',
                    ignore: 'pid,hostname',
                },
            },
        }),
    })

    return loggerInstance
}

export function getLogger(): Logger {
    if (!loggerInstance) {
        return createLogger()
    }
    return loggerInstance
}
