import {createTerminus} from '@godaddy/terminus'
import express from 'express'
import http, {Server} from 'http'
import {Logger} from 'pino'

import {BeaconManager} from './beaconManager'
import {createLogger, getLogger, LoggerOptions} from './logger'
import {findAvailablePort, killPortProcessBackground, setLogger as setPortManagerLogger} from './portManager'

const {
    NODE_ENV,
    READINESS_PERIOD_SECONDS = 10,
    READINESS_FAILURE_THRESHOLD = 3,
    KUBERNETES_SERVICE_HOST,
} = process.env

export type LifecycleConfig = {
    port?: number
    onReadyPromises?: Promise<any>[]
    onShutdown?: () => Promise<void>
    readinessPeriodSeconds?: number
    readinessFailureThreshold?: number
    logger?: Logger
    loggerOptions?: LoggerOptions
}

export class LifecycleServer {
    private isReady = false
    private isShuttingDown = false
    private httpServer: Server | null = null
    private promises: Promise<any>[] = []
    private beaconManager: BeaconManager
    private logger: Logger

    constructor(logger?: Logger) {
        this.logger = logger || getLogger().child({component: 'LifecycleServer'})
        this.beaconManager = new BeaconManager(this.logger)
        // Set logger for portManager
        setPortManagerLogger(this.logger)
    }

    getBeaconManager(): BeaconManager {
        return this.beaconManager
    }

    async setReady(value: boolean): Promise<void> {
        if (value && this.promises.length > 0) {
            this.logger.info('Waiting for initialization promises to resolve...')
            await Promise.all(this.promises)
            this.logger.info('All initialization promises resolved')
        }
        this.isReady = value
    }

    getReady(): boolean {
        return this.isReady
    }

    setShuttingDown(value: boolean): void {
        this.isShuttingDown = value
    }

    isServerShuttingDown(): boolean {
        return this.isShuttingDown
    }

    init(config: LifecycleConfig): Server {
        const {
            port = 9000,
            onReadyPromises = [],
            onShutdown,
            readinessPeriodSeconds = Number(READINESS_PERIOD_SECONDS),
            readinessFailureThreshold = Number(READINESS_FAILURE_THRESHOLD),
            logger,
            loggerOptions,
        } = config

        // Use provided logger or create one
        if (logger) {
            this.logger = logger.child({component: 'LifecycleServer'})
            setPortManagerLogger(this.logger)
        } else if (loggerOptions) {
            this.logger = createLogger(loggerOptions).child({component: 'LifecycleServer'})
            setPortManagerLogger(this.logger)
        }

        // Store promises for later
        this.promises = onReadyPromises

        const app = express()
        app.get('/', (req, res) => {
            res.send('ok')
        })
        this.httpServer = http.createServer(app)

        const isKubernetes = Boolean(KUBERNETES_SERVICE_HOST)
        createTerminus(this.httpServer, {
            healthChecks: {
                '/health': ({state}) => {
                    if (state.isShuttingDown) {
                        this.logger.warn('Health check failed: SERVER_IS_SHUTTING_DOWN')
                        return Promise.reject(new Error('SERVER_IS_SHUTTING_DOWN'))
                    }
                    if (!this.getReady()) {
                        this.logger.warn('Health check failed: SERVER_IS_NOT_READY')
                        return Promise.reject(new Error('SERVER_IS_NOT_READY'))
                    }
                    this.logger.debug('Health check passed: SERVER_IS_READY')
                    return Promise.resolve('SERVER_IS_READY')
                },
                '/live': ({state}) => {
                    if (state.isShuttingDown) {
                        this.logger.warn('Liveness check failed: SERVER_IS_SHUTTING_DOWN')
                        return Promise.reject(new Error('SERVER_IS_SHUTTING_DOWN'))
                    }
                    this.logger.debug('Liveness check passed: SERVER_IS_NOT_SHUTTING_DOWN')
                    return Promise.resolve('SERVER_IS_NOT_SHUTTING_DOWN')
                },
                '/ready': ({state}) => {
                    if (state.isShuttingDown || !this.getReady()) {
                        this.logger.warn('Readiness check failed: SERVER_IS_NOT_READY')
                        return Promise.reject(new Error('SERVER_IS_NOT_READY'))
                    }
                    this.logger.debug('Readiness check passed: SERVER_IS_READY')
                    return Promise.resolve('SERVER_IS_READY')
                },
            },
            onSignal: async () => {
                // Signal that we're shutting down
                this.logger.info('Shutdown signal received')
                this.setShuttingDown(true)
                await this.beaconManager.waitForBeacons()
                if (onShutdown) {
                    this.logger.info('Executing custom shutdown handler')
                    return onShutdown()
                }
            },
            beforeShutdown: () => {
                return new Promise<void>((resolve) => {
                    const delay = readinessPeriodSeconds * readinessFailureThreshold * 1000 || 5000
                    if (isKubernetes) {
                        this.logger.info({delayMs: delay}, 'Waiting before shutdown (Kubernetes grace period)')
                        setTimeout(resolve, delay)
                    } else {
                        resolve()
                    }
                })
            },
            useExit0: true,
        })

        this.httpServer
            .listen(port, () => {
                this.logger.info({port}, '🌎 Lifecycle Server listening')
            })
            .on('error', async (error: any) => {
                if (error.code === 'EADDRINUSE' && NODE_ENV !== 'production') {
                    this.logger.warn({port}, 'Port still in use, finding alternative port...')
                    killPortProcessBackground(port)
                    const availablePort = await findAvailablePort(port + 1)
                    this.logger.info({port: availablePort}, 'Using alternative port')

                    this.httpServer!.listen(availablePort, () => {
                        this.logger.info({port: availablePort}, '🌎 Lifecycle Server listening')
                    })
                } else {
                    this.logger.error({error}, 'Server error')
                }
            })

        return this.httpServer
    }
}

// Factory function for the desired API
export function createLifecycleServer(config: LifecycleConfig): LifecycleServer {
    const lifecycle = new LifecycleServer(config.logger)
    lifecycle.init(config)
    return lifecycle
}

// Export singleton beaconManager for convenience
export {BeaconManager} from './beaconManager'
export const beaconManager = new BeaconManager()
