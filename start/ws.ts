import CustomerServicesController from '#controllers/customer_services_controller'
import adonisServer from '@adonisjs/core/services/server'
import { WebSocketServer, WebSocket } from 'ws'

const wss = new WebSocketServer({ noServer: true })

wss.on('error', console.error)

adonisServer.getNodeServer()?.on('upgrade', (request, socket, head) => {
  const { pathname } = new URL(request.url ?? '', 'wss://base.url')

  if (pathname == '/ws') {
    wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
      console.log('registering server-side event handlers for websocket')

      new CustomerServicesController().handleTwilioWebsocket(ws)
    })
  } else {
    socket.destroy()
  }
})
