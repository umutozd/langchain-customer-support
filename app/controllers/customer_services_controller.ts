// import type { HttpContext } from '@adonisjs/core/http'

import OpenAI from 'openai'
import fs from 'fs'

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

const openaiApiKey = process.env.OPENAI_API_KEY

const openai = new OpenAI({
  apiKey: openaiApiKey,
})

export default class CustomerServicesController {
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
}
