// import type { HttpContext } from '@adonisjs/core/http'

import OpenAI from 'openai'
import fs, { read } from 'fs'

import { HttpContext } from '@adonisjs/core/http'

import { TextLoader } from 'langchain/document_loaders/fs/text'
import { MemoryVectorStore } from 'langchain/vectorstores/memory'
import { OpenAIEmbeddings } from '@langchain/openai'
import { createRetrieverTool } from 'langchain/tools/retriever'
import { ChatOpenAI } from '@langchain/openai'
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts'
import { HumanMessagePromptTemplate, SystemMessagePromptTemplate } from '@langchain/core/prompts'
import { createOpenAIFunctionsAgent, AgentExecutor } from 'langchain/agents'
import Conversation from '#models/conversation'
import { randomUUID } from 'crypto'
import ConversationItem from '#models/conversation_item'
import { WebSocket } from 'ws'
import twilio from 'twilio'
import { base64 } from '@adonisjs/core/helpers'
import { WaveFile } from 'wavefile'
import { Readable, Stream } from 'stream'
import speech from '@google-cloud/speech'

const openaiApiKey = process.env.OPENAI_API_KEY
const serverUrl = 'bf41-80-147-13-93.ngrok-free.app'
// const VoiceResponse = require('twilio').twiml.VoiceResponse

const openai = new OpenAI({
  apiKey: openaiApiKey,
})

const client = new speech.SpeechClient()

export default class CustomerServicesController {
  async answerTwilioCall({ response }: HttpContext) {
    const voiceResponse = new twilio.twiml.VoiceResponse()

    const connect = voiceResponse.connect()
    connect.stream({ url: `wss://${serverUrl}/ws` })

    response.safeHeader('Content-Type', 'text/xml')
    response.send(voiceResponse.toString())
  }

  // TODO: move this method to somewhere else because it's not a handler and this class is a controller
  async handleTwilioWebsocket(ws: WebSocket) {
    const recognizeStream = this.createGcpRecognizeStream()
    ws.addEventListener('message', async (websocketEvent) => {
      console.log('got message on websocket %s', websocketEvent.data.toString())

      const data: TwilioWebsocketMessage = JSON.parse(websocketEvent.data.toString())
      switch (data.event) {
        case 'connected':
          break
        case 'start':
          // save streamId somewhere to keep track of later
          break
        case 'media':
          // save audio content
          // const payload = base64.decode(data.media?.payload ?? '') ?? ''
          // const wav = new WaveFile()
          // wav.fromMuLaw(payload)

          recognizeStream.push(data.media?.payload, 'base64')

        default:
          break
      }
    })
  }

  async transcribeAudio({ response }: HttpContext) {
    console.log('transcripting')
    const result = await openai.audio.transcriptions.create({
      model: 'whisper-1',
      file: fs.createReadStream('/Users/umutozdogan/Developer/github/hubblr/adonis/voice.mp3'),
    })
    console.log(result.text)
    response.send({
      transcribed_text: result.text,
    })
  }

  async chat({ request, response }: HttpContext) {
    // get and validate input
    const conversationId = request.input('conversation_id', '')
    const userInput = request.input('input', '')
    if (typeof conversationId != 'string') {
      response.badRequest({
        message: 'conversation_id must be a string or null',
      })
      return
    }
    if (typeof userInput != 'string' || userInput == '') {
      response.badRequest({
        message: 'input must be a non-empty string',
      })
      return
    }

    // get or create conversation
    const conversation = await this.getOrCreateConversation(conversationId)
    if (conversation == null) {
      response.notFound({
        message: 'conversation not found',
      })
      return
    }

    // fetch conversation items and convert to chat history
    const conversationHistory = await this.getConversationItemsAsChatHistory(conversation.id)
    if (conversationHistory == null) {
      response.internalServerError({
        message: 'failed to fetch conversation history from database',
      })
      return
    }

    // save user's text to database
    this.saveConversationItem(conversation.id, userInput, 'user', conversationHistory.length + 1)

    // create agent executor and run it against the user input
    const agent = await this.createAgentExecutor()
    const result = await agent.invoke({
      input: request.input('input'),
      chat_history: conversationHistory, // the history without the users's current input
    })
    console.log(result)

    const output = result['output']
    if (typeof output != 'string') {
      response.internalServerError({
        message: 'failed to send message to the agent',
      })
      return
    }

    // save agent response to the history
    this.saveConversationItem(conversation.id, output, 'agent', conversationHistory.length + 2)

    return {
      output: output,
      conversation_id: conversation.id,
    }
  }

  private async createAgentExecutor() {
    // load documents first
    const loader = new TextLoader(
      '/Users/umutozdogan/Developer/github/hubblr/adonis/llm-source.txt'
    )
    const docs = await loader.load()

    // vectorize the documents for faster access
    const vectorStore = await MemoryVectorStore.fromDocuments(
      docs,
      new OpenAIEmbeddings({ apiKey: openaiApiKey })
    )

    // create a retriever tool from the vectors to be used by the agent
    const retrieverTool = createRetrieverTool(vectorStore.asRetriever(), {
      name: 'source_of_truth',
      description:
        'The source of truth for all the searches. For all questions, you must use this tool!',
    })
    const tools = [retrieverTool]

    // the OpenAI client to be used by Langchain
    const llm = new ChatOpenAI({
      apiKey: openaiApiKey,
      model: 'gpt-3.5-turbo',
      temperature: 0,
    })

    // prepare the prompt with system/user prompt templates and placeholders for chat-history and agent scratchpad
    const prompt = ChatPromptTemplate.fromMessages([
      SystemMessagePromptTemplate.fromTemplate(
        "You are a helpful assistant for question-answering tasks. If you don't know the answer, just say that you don't know. Use three sentences maximum and keep the answer concise."
      ),
      new MessagesPlaceholder({
        variableName: 'chat_history',
        optional: true,
      }),
      HumanMessagePromptTemplate.fromTemplate('{input}'),
      new MessagesPlaceholder({
        variableName: 'agent_scratchpad',
      }),
    ])

    // create the agent and agent executor
    const agent = await createOpenAIFunctionsAgent({
      llm,
      tools,
      prompt,
    })
    const agentExecutor = new AgentExecutor({
      agent,
      tools,
    })

    return agentExecutor
  }

  private async getOrCreateConversation(conversationId: string): Promise<Conversation | null> {
    try {
      if (conversationId == '') {
        // create new conversation
        return await Conversation.create({
          id: randomUUID(),
        })
      }
      return Conversation.findOrFail(conversationId)
    } catch {
      return null
    }
  }

  private async getConversationItemsAsChatHistory(
    conversationId: string
  ): Promise<string[] | null> {
    const items = await ConversationItem.findManyBy({
      conversationId: conversationId,
    })
    if (items == null || items == undefined) {
      return []
    }

    return items.map((item) => {
      return item.text
    })
  }

  private async saveConversationItem(
    conversationId: string,
    text: string,
    author: 'agent' | 'user',
    order: number
  ) {
    return await ConversationItem.create({
      author,
      conversationId,
      order,
      text,
    })
  }

  private createGcpRecognizeStream() {
    return client
      .streamingRecognize({
        config: {
          encoding: 'LINEAR16',
          sampleRateHertz: 16000,
          languageCode: 'fr-FR',
          enableSpeakerDiarization: true,
          model: 'latest_long',
        },
        interimResults: true,
      })
      .on('error', console.error)
      .on('data', (data) => {
        console.log('------------- data -------------')
        for (const resultItem of data.results) {
          for (const alternative of resultItem.alternatives) {
            console.log(
              `Real time transcript : ${alternative?.transcript} [isFinal: ${resultItem?.isFinal}]`
            )
          }
        }
        // console.log(
        //   `Real time transcript : ${data.results[0]?.alternatives?.[0]?.transcript} [isFinal: ${data.results[0]?.isFinal}]`
        // );
        if (data.results[0]?.isFinal)
          console.log(
            'whole sentence :',
            data.results[0]?.alternatives?.[0]?.words?.map((w: any) => w.word)?.join(' ')
          )
        console.log('------------- data -------------')
      })
  }
}

interface TwilioWebsocketMessage {
  event: 'connected' | 'start' | 'media' | 'stop'
  sequenceNumber: number
  streamSid: string
  start?: TwilioWebsocketMessageStart
  media?: TwilioWebsocketMessageMedia
  stop?: TwilioWebsocketMessageStop
}

/**
 * The start message contains metadata about the Stream and is sent immediately after
 * the connected message. It is only sent once at the start of the Stream.
 */
interface TwilioWebsocketMessageStart {
  streamSid: string
  callSid: string
  mediaFormat: MediaFormat
}

/** This message type encapsulates the raw audio data. */
interface TwilioWebsocketMessageMedia {
  track: 'inbound' | 'outbound'
  /** The chunk for the message. The first message will begin with 1 and
   * increment with each subsequent message.
   **/
  chunk: number
  /** Raw audio in encoded base64 */
  payload: string
}

interface TwilioWebsocketMessageStop {
  /** The Account identifier that created the Stream */
  accountSid: string
  /** The Call identifier that started the Stream */
  callSid: string
}

interface MediaFormat {
  /** The encoding of the data in the upcoming payload. Value is always audio/x-mulaw. */
  encoding: string
  /** The sample rate in hertz of the upcoming audio data. Value is always 8000 */
  sampleRate: number
  /** The number of channels in the input audio data. Value is always 1 */
  channels: number
}
