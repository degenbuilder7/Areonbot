'use client'

import { ChatRequest, FunctionCallHandler } from "ai";
import { useChat, type Message } from "ai/react";
import toast from 'react-hot-toast'

import { cn } from '@/lib/utils'
import { ChatList } from '@/components/chat-list'
import { ChatPanel } from '@/components/chat-panel'
import { EmptyScreen } from '@/components/empty-screen'
import { ChatScrollAnchor } from '@/components/chat-scroll-anchor'
import { nanoid } from '@/lib/utils'
import { functionSchemas } from "@/lib/functions/schemas";
import { useEffect, useState } from "react";
import { createPublicClient, http } from "viem";
import { VerifyContractParams } from "@/lib/functions/types";

export interface ChatProps extends React.ComponentProps<'div'> {
  initialMessages?: Message[]
  id?: string
}


export function Chat({ id, initialMessages, className }: ChatProps) {
  const [verificationParams, setVerificationParams] = useState<VerifyContractParams>()
  const [polling, setPolling] = useState(false)

  useEffect(() => {
    const verifyFunction = async (verificationParams: VerifyContractParams) => {
      if (verificationParams) {
        const publicClient = createPublicClient({
          chain: verificationParams?.viemChain,
          transport: http(verificationParams?.viemChain?.rpcUrls?.default?.http[0])
        })
        try {
          console.log("waiting for 4 confirmations")
          const transactionReceipt = await publicClient.waitForTransactionReceipt(
            { hash: verificationParams?.deployHash, confirmations: 4 }
          )
          console.log("got 4 confirmations, verifying contract")
          if (transactionReceipt) {
            const verifyResponse = await fetch(
              '/api/verify-contract',
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify(verificationParams)
              })
            if (verifyResponse.ok) {
              setPolling(false)
            }
          }
        } catch (e) {
          console.log('Verification failed, may need more confirmations.', e)
        }
      }
    }

    if (polling && verificationParams) {
      const interval = setInterval(() => {
        verifyFunction(verificationParams)
      }, 10000)
      return () => clearInterval(interval)
    }
  }, [polling, verificationParams])



  const functionCallHandler: FunctionCallHandler = async (
    chatMessages,
    functionCall
  ) => {
    if (functionCall.name === 'deploy_contract') {
      // You now have access to the parsed arguments here (assuming the JSON was valid)
      // If JSON is invalid, return an appropriate message to the model so that it may retry?

      const response = await fetch(
        '/api/deploy-contract',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: functionCall.arguments
        })

      let content: string;
      let role: 'system' | 'function';

      if (response.ok) {
        const { explorerUrl, ipfsUrl, verificationParams } = await response.json()
        setVerificationParams(verificationParams)
        setPolling(true)
        content = JSON.stringify({ explorerUrl, ipfsUrl }) + '\n\n' + 'Your contract will be automativally verified after 4 block confirmations. Keep this tab open.'
        role = 'function'

      } else {
        const { error } = await response?.json() ?? {}
        content = JSON.stringify({ error }) + '\n\n' + 'Try to fix the error and show the user the updated code.'
        role = 'system'
      }

      const functionResponse: ChatRequest = {
        messages: [
          ...chatMessages,
          {
            id: nanoid(),
            name: 'deploy_contract',
            role: role,
            content: content,
          }
        ],
        functions: functionSchemas
      }

      return functionResponse

    }
  }

  const { messages, append, reload, stop, isLoading, input, setInput } =
    useChat({
      experimental_onFunctionCall: functionCallHandler,
      initialMessages,
      id,
      body: {
        id
      },
      onResponse(response) {
        if (response.status === 401) {
          toast.error(response.statusText)
        }
      }
    })
  return (
    <>
      <div className={cn('pb-[200px] pt-4 md:pt-10', className)}>
        {messages.length > 1 ? (
          <>
            <ChatList messages={messages} />
            <ChatScrollAnchor trackVisibility={isLoading} />
          </>
        ) : (
          <EmptyScreen setInput={setInput} />
        )}
      </div>
      <ChatPanel
        id={id}
        isLoading={isLoading}
        stop={stop}
        append={append}
        reload={reload}
        messages={messages}
        input={input}
        setInput={setInput}
      />
    </>
  )
}