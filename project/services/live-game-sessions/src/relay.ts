import { connect, type IttySocketOptions } from 'itty-sockets'

export type Channel = {
  publish(type: string, payload: object): void
  close(): void
}

export type ChannelOptions = {
  channel: string
  joinKey: string
  sendKey: string
  onJoin(alias: string): void
  onLeave(alias: string): void
}

export type OpenChannel = (options: ChannelOptions) => Promise<Channel>

export const openChannel: OpenChannel = ({ channel, joinKey, sendKey, onJoin, onLeave }) =>
  new Promise((resolve, reject) => {
    let opened = false
    let closed = false
    let attempt = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const socket = connect(channel, { joinKey, sendKey } as IttySocketOptions)
    socket
      .on('join', (event) => event.alias && onJoin(event.alias))
      .on('leave', (event) => event.alias && onLeave(event.alias))
      .on('error', (event) => console.error(`Relay error on ${channel}: ${event.message}`))
      .on('open', () => {
        opened = true
        attempt = 0
        resolve({
          publish: (type, payload) => socket.send({ ...payload, type }),
          close: () => {
            closed = true
            clearTimeout(timer)
            socket.close()
          },
        })
      })
      .on('close', () => {
        if (!opened) return reject(new Error('Relay connection was rejected or lost'))
        if (closed) return
        const delay = Math.random() * Math.min(30000, 1000 * 2 ** attempt++)
        console.error(`Relay connection to ${channel} lost; reconnecting in ${Math.round(delay)} ms`)
        clearTimeout(timer)
        timer = setTimeout(() => closed || socket.open(), delay)
      })
  })
