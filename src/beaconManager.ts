import {EventEmitter} from 'events'
import {Logger} from 'pino'

import {getLogger} from './logger'

type BeaconContext = Record<string, any>

type Beacon = {
    context: BeaconContext
}

type BeaconController = {
    die: () => Promise<void>
}

export class BeaconManager {
    private beacons: Beacon[] = []
    private eventEmitter = new EventEmitter()
    private logger: Logger

    constructor(logger?: Logger) {
        this.logger = logger || getLogger().child({component: 'BeaconManager'})
    }

    createBeacon(context?: BeaconContext): BeaconController {
        const beacon: Beacon = {
            context: context ?? {},
        }

        this.beacons.push(beacon)

        this.logger.debug({beaconsCount: this.beacons.length, context}, 'Beacon created')

        return {
            die: async () => {
                this.logger.debug({context: beacon.context}, 'Beacon dying')

                this.beacons.splice(this.beacons.indexOf(beacon), 1)
                this.eventEmitter.emit('beaconStateChange')

                this.logger.debug({remainingBeacons: this.beacons.length}, 'Beacon died')

                // Allow event loop to process
                await new Promise((resolve) => setImmediate(resolve))
            },
        }
    }

    async waitForBeacons(): Promise<void> {
        if (this.beacons.length === 0) {
            this.logger.info('No beacons to wait for')
            return
        }

        this.logger.info({beaconsCount: this.beacons.length}, 'Waiting for beacons to die')

        return new Promise<void>((resolve) => {
            const check = () => {
                if (this.beacons.length > 0) {
                    this.logger.info(
                        {
                            beaconsCount: this.beacons.length,
                            contexts: this.beacons.map((b) => b.context),
                        },
                        'Still waiting for beacons'
                    )
                } else {
                    this.logger.info('All beacons have died, proceeding with shutdown')
                    this.eventEmitter.off('beaconStateChange', check)
                    resolve()
                }
            }

            this.eventEmitter.on('beaconStateChange', check)
            check()
        })
    }

    getBeaconsCount(): number {
        return this.beacons.length
    }
}
