"use client"

import { useState } from "react"
import { TextField, Grid, IconButton, useMediaQuery, Box } from "@mui/material"
import SendIcon from "@mui/icons-material/Send"
import { TEXT, primary_50 } from "../utilities/constants"

function ChatInput({ onSendMessage, processing }) {
  const [message, setMessage] = useState("")
  const [helperText, setHelperText] = useState("")
  const isSmallScreen = useMediaQuery("(max-width:600px)")

  const handleTyping = (event) => {
    if (helperText) {
      setHelperText("")
    }
    setMessage(event.target.value)
  }

  const handleSendMessage = () => {
    if (message.trim() !== "") {
      onSendMessage(message)
      setMessage("")
    } else {
      setHelperText(TEXT.HELPER_TEXT)
    }
  }

  return (
    <Box
      sx={{
        width: "100%",
        maxWidth: "100%",
        padding: "0 1rem", // Add consistent padding
        boxSizing: "border-box", // Ensure padding doesn't cause overflow
        marginTop: "0.5rem", // Add top margin to move input up
      }}
    >
      <Grid
        container
        alignItems="center"
        className="sendMessageContainer"
        sx={{
          minHeight: "50px", // Reduce height
          borderRadius: "40px",
          backgroundColor: primary_50,
          padding: isSmallScreen ? "0 12px" : "0 24px",
          margin: "0 auto", // Center the input
          maxWidth: "100%", // Prevent overflow
          boxSizing: "border-box", // Include padding in width calculation
        }}
      >
        <Grid item xs={11}>
          <TextField
            multiline
            maxRows={isSmallScreen ? 2 : 3} // Reduce max rows
            fullWidth
            placeholder={TEXT.CHAT_INPUT_PLACEHOLDER}
            id="USERCHATINPUT"
            value={message}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !processing) {
                e.preventDefault()
                handleSendMessage()
              }
            }}
            onChange={handleTyping}
            helperText={helperText}
            sx={{
              "& fieldset": { border: "none" },
              "& .MuiInputBase-root": {
                backgroundColor: "transparent",
                fontSize: isSmallScreen ? "0.875rem" : "1rem",
                padding: "6px 0", // Reduce padding
              },
              "& .MuiFormHelperText-root": {
                margin: "3px 0 0",
                fontSize: isSmallScreen ? "0.7rem" : "0.75rem",
                position: "absolute", // Position helper text absolutely
                bottom: "-20px", // Position below the input
              },
            }}
          />
        </Grid>
        <Grid item xs={1} sx={{ display: "flex", justifyContent: "center" }}>
          <IconButton
            aria-label="send"
            disabled={processing}
            onClick={handleSendMessage}
            color={message.trim() !== "" ? "primary" : "default"}
            sx={{
              padding: isSmallScreen ? "4px" : "6px", // Reduce padding
            }}
          >
            <SendIcon fontSize={isSmallScreen ? "small" : "medium"} />
          </IconButton>
        </Grid>
      </Grid>
    </Box>
  )
}

export default ChatInput
