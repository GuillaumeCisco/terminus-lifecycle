import {exec} from 'child_process'
import {Logger} from 'pino'
import {promisify} from 'util'

import {getLogger} from './logger'

const {NODE_ENV} = process.env

const execAsync = promisify(exec)

let logger: Logger = getLogger().child({component: 'PortManager'})

export function setLogger(customLogger: Logger): void {
    logger = customLogger.child({component: 'PortManager'})
}

// Find next available port starting from startPort
export const findAvailablePort = async (startPort: number): Promise<number> => {
    try {
        const {stdout} = await execAsync(`lsof -ti:${startPort}`)
        if (stdout.trim()) {
            // Port is taken, try next one
            logger.debug({port: startPort}, 'Port is taken, trying next one')
            return findAvailablePort(startPort + 1)
        }
        logger.debug({port: startPort}, 'Found available port')
        return startPort
    } catch {
        // No process found on this port, it's available
        logger.debug({port: startPort}, 'Port is available')
        return startPort
    }
}

// Kill process on port in background (don't wait)
export const killPortProcessBackground = (port: number): void => {
    if (NODE_ENV === 'production') return

    exec(`lsof -ti:${port}`, (error, stdout) => {
        if (!error && stdout.trim()) {
            const pid = stdout.trim()
            logger.warn({pid, port}, 'Killing process on port in background')
            exec(`kill -9 ${pid}`, (killError) => {
                if (!killError) {
                    logger.info({pid, port}, 'Process killed successfully')
                } else {
                    logger.error({pid, port, error: killError}, 'Failed to kill process')
                }
            })
        }
    })
}

export default {findAvailablePort, killPortProcessBackground, setLogger}
