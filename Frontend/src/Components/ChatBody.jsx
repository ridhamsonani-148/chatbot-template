"use client"

import { useState, useRef, useEffect } from "react"
import { Box, Typography, useMediaQuery } from "@mui/material"
import ChatInput from "./ChatInput"
import UserReply from "./UserReply"
import StreamingResponse from "./StreamingResponse"
import BotReply from "./BotReply"
import createMessageBlock from "../utilities/createMessageBlock"
import { ALLOW_FAQ, CHAT_BODY_BACKGROUND, PRIMARY_MAIN } from "../utilities/constants"
import FAQExamples from "./FAQExamples"

function ChatBody() {
  const [messageList, setMessageList] = useState([])
  const [processing, setProcessing] = useState(false)
  const [questionAsked, setQuestionAsked] = useState(false)
  const messagesEndRef = useRef(null)
  const isSmallScreen = useMediaQuery("(max-width:600px)")

  useEffect(() => {
    scrollToBottom()
  }, [messageList])

  const scrollToBottom = () => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }

  const handleSendMessage = (message) => {
    setProcessing(true)
    const newMessageBlock = createMessageBlock(message, "USER", "TEXT", "SENT")
    setMessageList([...messageList, newMessageBlock])
    getBotResponse(setMessageList, setProcessing, message)
    setQuestionAsked(true)
  }

  const handlePromptClick = (prompt) => {
    handleSendMessage(prompt)
  }

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        position: "relative",
      }}
    >
      {/* Empty state or messages area */}
      {messageList.length > 0 || !ALLOW_FAQ || questionAsked ? (
        // Chat messages area with proper scrolling
        <Box
          className="chatScrollContainer appScroll"
          sx={{
            flex: "1 1 auto",
            overflowY: "auto",
            paddingBottom: "1rem",
            paddingTop: "0", // Remove top padding
            display: "flex",
            flexDirection: "column",
            // Adjust max height to leave space for input
            maxHeight: "calc(100% - 100px)",
          }}
        >
          {messageList.map((msg, index) => (
            <Box
              key={index}
              mb={3} // Increased from mb={2} to mb={3} for more spacing
              sx={{
                marginTop: index > 0 && messageList[index - 1].sentBy !== msg.sentBy ? "1.5rem" : "0.75rem",
              }}
            >
              {msg.sentBy === "USER" ? (
                <UserReply message={msg.message} />
              ) : msg.sentBy === "BOT" && msg.state === "PROCESSING" ? (
                <StreamingResponse initialMessage={msg.message} setProcessing={setProcessing} />
              ) : (
                <BotReply message={msg.message} />
              )}
            </Box>
          ))}
          <div ref={messagesEndRef} />
        </Box>
      ) : (
        // Empty state with FAQ section positioned higher
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            flex: "1 1 auto",
            justifyContent: "center", // Center content vertically
            paddingBottom: "2rem", // Add padding at bottom
          }}
        >
          {/* FAQ section - positioned in the center of the screen */}
          <Box
            sx={{
              width: "100%",
              padding: "1rem 0",
              marginBottom: "1rem",
            }}
          >
            <Typography
              variant="h6"
              sx={{
                textAlign: "center",
                marginBottom: "1.5rem",
                color: PRIMARY_MAIN,
                fontSize: isSmallScreen ? "1rem" : "1.25rem",
              }}
            >
              Frequently Asked Questions
            </Typography>
            <FAQExamples onPromptClick={handlePromptClick} />
          </Box>
        </Box>
      )}

      {/* Chat input area with fixed position */}
      <Box
        sx={{
          width: "100%",
          backgroundColor: CHAT_BODY_BACKGROUND,
          padding: "0.5rem 0 1rem",
          position: "sticky",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 10,
          marginTop: "auto", // Push to bottom
          boxShadow: "0px -2px 10px rgba(0,0,0,0.05)", // Add subtle shadow
          borderTop: "1px solid rgba(0,0,0,0.05)", // Add subtle border
        }}
      >
        <ChatInput onSendMessage={handleSendMessage} processing={processing} />
      </Box>
    </Box>
  )
}

export default ChatBody

const getBotResponse = (setMessageList, setProcessing, message) => {
  // Simulate a response after a short delay
  setTimeout(() => {
    const botMessageBlock = createMessageBlock(
      "This is a simulated response. In production, this would come from Amazon Q Business.",
      "BOT",
      "TEXT",
      "RECEIVED",
    )
    setMessageList((prevList) => [...prevList, botMessageBlock])
    setProcessing(false)
  }, 1500)
}
