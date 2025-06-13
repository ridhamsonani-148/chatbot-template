// Primary color constants for the theme
export const PRIMARY_MAIN = "#1F0F40" // Dark purple for nav panel
export const primary_50 = "#E7E3F0" // Light purple for chat bubbles
export const SECONDARY_MAIN = "#D3D3D3" // Secondary color

// Background color constants
export const CHAT_BODY_BACKGROUND = "#FFFFF7" // White background for chat
export const CHAT_LEFT_PANEL_BACKGROUND = "#1F0F40" // Dark purple for left panel
export const ABOUT_US_HEADER_BACKGROUND = "#FFFFFF" // White text for headers in left panel
export const FAQ_HEADER_BACKGROUND = "#FFFFFF" // White text for headers in left panel
export const ABOUT_US_TEXT = "#FFFFFF" // White text for about us
export const FAQ_TEXT = "#FFFFFF" // White text for FAQs
export const HEADER_BACKGROUND = "#FFFFFF" // White background for header
export const HEADER_TEXT_GRADIENT = "#1F0F40" // Dark purple for header text

// Message background colors
export const BOTMESSAGE_BACKGROUND ="#DDEAF3" // Light purple for bot messages
export const USERMESSAGE_BACKGROUND = "#E7E3F0" // Light purple for user messages

// API endpoints
export const CHAT_API = process.env.REACT_APP_CHAT_API
export const WEBSOCKET_API = process.env.REACT_APP_WEBSOCKET_API

// Features
export const ALLOW_FILE_UPLOAD = false
export const ALLOW_FAQ = true

// Text Constants
export const TEXT = {
  APP_NAME: "Catholic Charities AI Assistant",
  APP_ASSISTANT_NAME: "Catholic Charities AI Assistant",
  ABOUT_US_TITLE: "About us",
  ABOUT_US:
    "Welcome to the Catholic Charities AI Assistant. We bring together all our services in one place so you can quickly find help or information.",
  FAQ_TITLE: "FAQs",
  FAQS: [
    "How do I apply for assistance?",
    "How can I donate to Catholic Charities?",
    "What is the mission of Catholic Charities?",
    "What is Catholic Charities USA?",
  ],
  CHAT_HEADER_TITLE: "Catholic Charities AI Assistant",
  CHAT_INPUT_PLACEHOLDER: "Type your query here...",
  HELPER_TEXT: "Cannot send empty message",
}
