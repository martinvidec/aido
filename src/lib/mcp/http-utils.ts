// Attempt to polyfill Web Streams if they are missing from global scope
import { ReadableStream as NodeWebReadableStream, WritableStream as NodeWebWritableStream } from 'node:stream/web';

// @ts-ignore
if (typeof globalThis.ReadableStream === 'undefined') {
  // @ts-ignore
  globalThis.ReadableStream = NodeWebReadableStream;
  console.log('[Polyfill - http-utils] globalThis.ReadableStream was polyfilled.');
}
// @ts-ignore
if (typeof globalThis.WritableStream === 'undefined') {
  // @ts-ignore
  globalThis.WritableStream = NodeWebWritableStream;
  console.log('[Polyfill - http-utils] globalThis.WritableStream was polyfilled.');
}
// End Polyfill

import { EventEmitter } from 'events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'net';
import { PassThrough } from 'stream';

// Manual mock for ServerResponse for SSE GET requests, now in http-utils.ts
export class ManualMockServerResponse extends EventEmitter implements ServerResponse {
    private _headers: Record<string, string | number | string[]> = {};
    statusCode: number = 200;
    statusMessage: string = 'OK';
    headersSent: boolean = false;
    sendDate: boolean = true;
    // @ts-ignore
    req: IncomingMessage; 

    writable: boolean = true;
    writableEnded: boolean = false;
    writableFinished: boolean = false;
    writableHighWaterMark: number;
    writableLength: number;
    writableObjectMode: boolean = false;
    writableCorked: number = 0;
    destroyed: boolean = false;
    // @ts-ignore
    closed: boolean = false;
    // @ts-ignore
    errored: Error | null = null;
    finished: boolean = false;

    constructor(private sseStreamTarget: PassThrough, request: IncomingMessage) {
        super();
        // @ts-ignore
        this.req = request;
        this.writableHighWaterMark = this.sseStreamTarget.writableHighWaterMark;
        this.writableLength = this.sseStreamTarget.writableLength;
        this.sseStreamTarget.on('finish', () => this.emit('finish'));
        this.sseStreamTarget.on('close', () => this.emit('close'));
    }

    setHeader(name: string, value: string | number | string[]): this {
        this._headers[name.toLowerCase()] = value;
        return this;
    }

    getHeader(name: string): string | number | string[] | undefined {
        return this._headers[name.toLowerCase()];
    }

    getHeaders(): Record<string, string | number | string[]> {
        return this._headers;
    }

    hasHeader(name: string): boolean {
        return name.toLowerCase() in this._headers;
    }
    
    removeHeader(name: string): void {
        delete this._headers[name.toLowerCase()];
    }

    // @ts-ignore
    writeHead(statusCode: number, statusMessage?: string | Record<string, string | number | string[]>, headers?: Record<string, string | number | string[]>): this {
        this.statusCode = statusCode;
        let actualHeaders: Record<string, string | number | string[]> | undefined;
        if (typeof statusMessage === 'object') {
            this.statusMessage = '';
            actualHeaders = statusMessage;
        } else if (typeof statusMessage === 'string') {
            this.statusMessage = statusMessage;
            if (headers) {
                actualHeaders = headers;
            }
        }
        
        if (actualHeaders) {
            for (const [key, value] of Object.entries(actualHeaders)) {
                this.setHeader(key, value);
            }
        }
        this.headersSent = true; 
        return this;
    }
    
    write(chunk: any, encoding?: BufferEncoding | ((error?: Error | null) => void), cb?: (error?: Error | null) => void): boolean {
        let callback: ((error?: Error | null) => void) | undefined;
        let actualEncoding: BufferEncoding = 'utf-8';

        if (typeof encoding === 'function') {
            callback = encoding;
        } else if (typeof encoding === 'string') {
            actualEncoding = encoding;
            if (typeof cb === 'function') {
                callback = cb;
            }
        } else if (typeof cb === 'function') {
            callback = cb;
        }
        
        const success = this.sseStreamTarget.write(chunk, actualEncoding);
        if (callback) {
            process.nextTick(() => callback(null));
        }
        return success;
    }

    end(chunk?: any, encodingOrCb?: BufferEncoding | (() => void), cb?: () => void): this {
        let callback: (() => void) | undefined;
        let encoding: BufferEncoding = 'utf-8';

        if (typeof chunk === 'function') {
            callback = chunk; chunk = undefined;
        } else if (typeof encodingOrCb === 'function') {
            callback = encodingOrCb;
        } else if (typeof encodingOrCb === 'string') {
            encoding = encodingOrCb;
            if (typeof cb === 'function') callback = cb;
        }

        if (chunk && typeof chunk !== 'function') {
            this.sseStreamTarget.write(chunk, encoding);
        }
        this.sseStreamTarget.end();
        this.writableEnded = true;
        this.writableFinished = true;
        this.finished = true;
        if (callback) process.nextTick(callback);
        return this;
    }

    flushHeaders(): void { /* For SSE, headers are part of the initial response */ }
    
    get socket(): Socket | null { return null; }
    get connection(): Socket | null { return null; }
    assignSocket(_socket: Socket): void {}
    detachSocket(_socket: Socket): void {}
    // @ts-ignore
    writeContinue(callback?: () => void): void { if(callback) callback(); }
    // @ts-ignore
    setTimeout(_msecs: number, callback?: () => void): this { if(callback) callback(); return this; }
    // @ts-ignore
    addTrailers(_headers: any): void {}

    _write(chunk: any, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
        this.sseStreamTarget._write(chunk, encoding, callback);
    }
    _final(callback: (error?: Error | null) => void): void {
        // @ts-ignore
        this.sseStreamTarget._final?.(callback);
         if(!this.sseStreamTarget._final) callback();
    }
    _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
        this.sseStreamTarget.destroy(error || undefined);
        this.destroyed = true;
        callback(error);
    }
    cork(): void { this.sseStreamTarget.cork(); }
    uncork(): void { this.sseStreamTarget.uncork(); }
    destroy(error?: Error): this {
        this.sseStreamTarget.destroy(error);
        this.destroyed = true;
        return this;
    }
    // @ts-ignore
    getwritableEnded(): boolean { return this.writableEnded; }
    // @ts-ignore
    setDefaultEncoding(encoding: BufferEncoding): this {
        this.sseStreamTarget.setDefaultEncoding(encoding);
        return this;
    }
    // @ts-ignore
    pipe<T extends NodeJS.WritableStream>(destination: T, options?: { end?: boolean; }): T {
        return this.sseStreamTarget.pipe(destination, options);
    }
} 