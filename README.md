# terminus-lifecycle

> Kubernetes-ready lifecycle management with graceful shutdown and beacon tracking

[![npm version](https://badge.fury.io/js/@guillaumecisco%2Fterminus-lifecycle.svg)](https://www.npmjs.com/package/@guillaumecisco/terminus-lifecycle)
[![CI](https://github.com/GuillaumeCisco/terminus-lifecycle/workflows/CI/badge.svg)](https://github.com/GuillaumeCisco/terminus-lifecycle/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Downloads](https://img.shields.io/npm/dm/@guillaumecisco/terminus-lifecycle.svg)](https://www.npmjs.com/package/@guillaumecisco/terminus-lifecycle)

A modern, TypeScript-first library for managing application lifecycle in Kubernetes environments. Built on top of [@godaddy/terminus](https://github.com/godaddy/terminus) with enhanced features:

- 🎯 **Beacon tracking** - Track ongoing operations during shutdown
- 🏥 **Health checks** - `/health`, `/live`, and `/ready` endpoints
- 🔄 **Graceful shutdown** - Wait for in-flight operations to complete
- 📊 **Structured logging** - Built-in pino logger with pretty printing
- 🐳 **Kubernetes-native** - Designed for K8s readiness/liveness probes
- 🔌 **Default instance** - Access lifecycle state from anywhere in your app

## Installation

```shell
$> npm install @guillaumecisco/terminus-lifecycle
# or
$> yarn add @guillaumecisco/terminus-lifecycle
```

For pretty logs in development:
```shell
$> npm install --save-dev pino-pretty
``` 

## Quick Start
```typescript
import { createLifecycleServer } from '@guillaumecisco/terminus-lifecycle'

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

### Default Lifecycle Instance

The first lifecycle server created becomes the default instance, accessible from anywhere in your application:

```typescript
import { createLifecycleServer, getDefaultLifecycle } from '@guillaumecisco/terminus-lifecycle'

// In your main file
createLifecycleServer({ port: 9000 })

// In any other file
import { getDefaultLifecycle } from '@guillaumecisco/terminus-lifecycle'

async function processJobs(jobs) {
    for (const job of jobs) {
        if (getDefaultLifecycle().isServerShuttingDown()) {
            console.log('Shutdown detected, stopping job processing')
            break
        }
        await processJob(job)
    }
}
```

### Beacon Manager

Track ongoing operations to ensure graceful shutdown:
```typescript
import { beaconManager } from '@guillaumecisco/terminus-lifecycle'

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
import { createLifecycleServer, createLogger } from '@guillaumecisco/terminus-lifecycle'

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

- **`GET /`** - Simple OK response
- **`GET /health`** - Overall health (ready and not shutting down)
- **`GET /live`** - Liveness probe (not shutting down)
- **`GET /ready`** - Readiness probe (initialization complete and not shutting down)

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

### `getDefaultLifecycle()`

Returns the default lifecycle server instance (the first one created).

**Throws:** Error if no lifecycle server has been created yet.

**Example:**
```typescript
import { getDefaultLifecycle } from '@guillaumecisco/terminus-lifecycle'

if (getDefaultLifecycle().isServerShuttingDown()) {
    // Stop accepting new work
}
```

### `LifecycleServer` Methods

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
import { createLifecycleServer, createLogger, beaconManager } from '@guillaumecisco/terminus-lifecycle'

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

## Releasing

### 1. Update the version in package.json
```shell
$> npm version patch  # or minor, or major
```

### 2. Push with tags
```shell
$> git push && git push --tags
```

### 3. Create the release on GitHub
```shell
$> gh release create v1.0.0 --title "Release 1.0.0" --notes "Initial release"
```
