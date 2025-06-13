"use client"

import { useState, useEffect, useRef } from "react"
import { Grid, Avatar, Typography } from "@mui/material"
import BotAvatar from "../Assets/BotAvatar.svg"
import { WEBSOCKET_API } from "../utilities/constants"

const StreamingResponse = ({ initialMessage, setProcessing }) => {
  const [responses, setResponses] = useState([])
  const ws = useRef(null)
  const messageBuffer = useRef("")

  useEffect(() => {
    // Initialize WebSocket connection
    ws.current = new WebSocket(WEBSOCKET_API)

    ws.current.onopen = () => {
      console.log("WebSocket Connected")
      // Send initial message
      ws.current.send(JSON.stringify({ action: "sendMessage", prompt: initialMessage }))
    }

    ws.current.onmessage = (event) => {
      try {
        messageBuffer.current += event.data
        const parsedData = JSON.parse(messageBuffer.current)

        if (parsedData.type === "end") {
          setProcessing(false)
          console.log("end of conversation")
        }

        if (parsedData.type === "delta") {
          setResponses((prev) => [...prev, parsedData.text])
        }

        messageBuffer.current = ""
      } catch (e) {
        if (e instanceof SyntaxError) {
          console.log("Received incomplete JSON, waiting for more data...")
        } else {
          console.error("Error processing message: ", e)
          messageBuffer.current = ""
        }
      }
    }

    ws.current.onerror = (error) => {
      console.log("WebSocket Error: ", error)
    }

    ws.current.onclose = (event) => {
      if (event.wasClean) {
        console.log(`WebSocket closed cleanly, code=${event.code}, reason=${event.reason}`)
      } else {
        console.log("WebSocket Disconnected unexpectedly")
      }
    }

    return () => {
      if (ws.current) {
        ws.current.close()
      }
    }
  }, [initialMessage, setProcessing])

  return (
    <Grid container direction="row" justifyContent="flex-start" alignItems="flex-end" sx={{ marginBottom: "1rem" }}>
      <Grid item>
        <Avatar alt="Bot Avatar" src={BotAvatar} sx={{ width: 40, height: 40 }} />
      </Grid>
      <Grid
        item
        className="botMessage"
        sx={{
          backgroundColor: (theme) => theme.palette.background.botMessage,
          borderRadius: "2rem",
          padding: "0.75rem 1.5rem",
          marginLeft: "0.5rem",
          maxWidth: "75%",
        }}
      >
        <Typography variant="body2">{responses.join("")}</Typography>
      </Grid>
    </Grid>
  )
}

export default StreamingResponse
