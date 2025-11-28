# terminus-lifecycle

> Kubernetes-ready lifecycle management with graceful shutdown and beacon tracking

[![npm version](https://badge.fury.io/js/terminus-lifecycle.svg)](https://www.npmjs.com/package/terminus-lifecycle)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A modern, TypeScript-first library for managing application lifecycle in Kubernetes environments. Built on top of [@godaddy/terminus](https://github.com/godaddy/terminus) with enhanced features:

- 🎯 **Beacon tracking** - Track ongoing operations during shutdown
- 🏥 **Health checks** - `/health`, `/live`, and `/ready` endpoints
- 🔄 **Graceful shutdown** - Wait for in-flight operations to complete
- 📊 **Structured logging** - Built-in pino logger with pretty printing
- 🐳 **Kubernetes-native** - Designed for K8s readiness/liveness probes

## Installation

```shell
$> bash npm install terminus-lifecycle
# or
$> yarn add terminus-lifecycle
```

For pretty logs in development:
```shell
$> bash npm install --save-dev pino-pretty
``` 

## Quick Start
```typescript
import { createLifecycleServer } from 'terminus-lifecycle'

const lifecycle = createLifecycleServer({ 
    port: 9000,
    onReadyPromises: YourAsyncInitializationTasksConnectToDatabase().startMessageQueue(),
    onShutdown: async () => {
      // Custom cleanup logic await closeConnections() 
    },
})

// Start your main application
app.listen(3000, async () => { await lifecycle.setReady(true) })
```

## Features

### Beacon Manager

Track ongoing operations to ensure graceful shutdown:
```typescript
import { beaconManager } from 'terminus-lifecycle'

async function processJob(job) {
    const beacon = beaconManager.createBeacon({ name: 'processJob', jobId: job.id })
    try { 
        await doWork(job) 
    } 
    finally {
        await beacon.die()
    } 
}
``` 

### Custom Logger
```typescript
import { createLifecycleServer, createLogger } from 'terminus-lifecycle'

const logger = createLogger({ 
    level: 'debug',
    prettify: true, // pretty print in development
})
const lifecycle = createLifecycleServer({ 
    port: 9000,
    logger,
    onShutdown: async () => {
        logger.info('Shutting down gracefully')
    } 
})
```

### Health Check Endpoints

The lifecycle server automatically creates three endpoints:

- **`GET /health`** - Overall health (ready and not shutting down)
- **`GET /live`** - Liveness probe (not shutting down)
- **`GET /ready`** - Readiness probe (initialization complete and not shutting down)

### Checking Shutdown State
```typescript
import { createLifecycleServer } from 'terminus-lifecycle'

const lifecycle = createLifecycleServer({ port: 9000 })
// In your job processing loop
async function processJobs(jobs) {
    for (const job of jobs) {
        if (lifecycle.isServerShuttingDown()) { 
            console.log('Shutdown detected, stopping job processing')
            break
        } 
        await processJob(job) 
    } 
}
``` 

## API

### `createLifecycleServer(config)`

Creates and initializes a lifecycle server.

**Config Options:**
```typescript
 { 
    port?: number // Default: 9000
    onReadyPromises?: Promise[] // Promises to wait for before marking ready
    onShutdown?: () => Promise // Custom shutdown handler
    readinessPeriodSeconds?: number // K8s readiness period (default: 10)
    readinessFailureThreshold?: number // K8s failure threshold (default: 3)
    logger?: Logger // Custom pino logger instance
    loggerOptions?: LoggerOptions // Or logger options 
}
```

**Returns:** `LifecycleServer` instance

**Methods:**
- `setReady(value: boolean)` - Mark server as ready/not ready
- `getReady()` - Check if server is ready
- `isServerShuttingDown()` - Check if shutdown has started
- `getBeaconManager()` - Get the beacon manager instance

### `beaconManager`

Singleton beacon manager for convenience.

**Methods:**
- `createBeacon(context?: object)` - Create a new beacon
    - Returns: `{ die: () => Promise<void> }`
- `waitForBeacons()` - Wait for all beacons to complete
- `getBeaconsCount()` - Get current beacon count

### `createLogger(options)`

Create a structured logger.

**Options:**
```typescript
{ 
    level?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'
    enabled?: boolean // Default: true
    prettify?: boolean // Default: NODE_ENV !== 'production'
}
``` 

## Kubernetes Example
```yaml
apiVersion: v1
kind: Pod
metadata:
  name: myapp
spec:
  containers:
    - name: app
      image: myapp:latest
      ports:
        - name: http
          containerPort: 3000
        - name: lifecycle
          containerPort: 9000
      livenessProbe:
        httpGet:
          path: /live
          port: lifecycle
        initialDelaySeconds: 5
        periodSeconds: 10
      readinessProbe:
        httpGet:
          path: /ready
          port: lifecycle
        initialDelaySeconds: 5
        periodSeconds: 5
```

## Complete Example
```typescript
import express from 'express'
import { createLifecycleServer, createLogger, beaconManager } from 'terminus-lifecycle'

const logger = createLogger({ level: 'info' })
const app = express()

// Your routes
app.get('/api/data', async (req, res) => {
    const beacon = beaconManager.createBeacon({
        endpoint: '/api/data'
    })
    try {
        const data = await fetchData()
        res.json(data)
    } finally {
        await beacon.die()
    }
})

// Initialize dependencies
const dbPromise = connectToDatabase()
const redisPromise = connectToRedis()

// Create lifecycle server
const lifecycle = createLifecycleServer({
    port: 9000,
    onReadyPromises: [dbPromise, redisPromise],
    logger,
    onShutdown: async () => {
        logger.info('Cleaning up resources')
        const [db, redis] = await Promise.all([dbPromise, redisPromise])
        await db.close()
        await redis.disconnect()
    }
})

// Start main application
const server = app.listen(3000, async () => {
    logger.info('Application started on port 3000')
    await lifecycle.setReady(true)
})
```

## License

MIT © [Guillaume Cisco]

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
