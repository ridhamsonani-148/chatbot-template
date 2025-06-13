import { createTheme } from "@mui/material/styles"
import {
  PRIMARY_MAIN,
  primary_50,
  SECONDARY_MAIN,
  CHAT_LEFT_PANEL_BACKGROUND,
  BOTMESSAGE_BACKGROUND,
  USERMESSAGE_BACKGROUND,
} from "./utilities/constants"

const theme = createTheme({
  palette: {
    primary: {
      main: PRIMARY_MAIN,
      50: primary_50,
    },
    secondary: {
      main: SECONDARY_MAIN,
    },
    background: {
      chatBody: "#FFFFF7", // Updated to the new background color
      chatLeftPanel: CHAT_LEFT_PANEL_BACKGROUND,
      header: "#FFFFF7", // Updated to the new background color
      botMessage: BOTMESSAGE_BACKGROUND,
      userMessage: USERMESSAGE_BACKGROUND,
    },
  },
  typography: {
    fontFamily: [
      "Lato",
      "-apple-system",
      "BlinkMacSystemFont",
      "Segoe UI",
      "Roboto",
      "Oxygen",
      "Ubuntu",
      "Cantarell",
      "Fira Sans",
      "Droid Sans",
      "Helvetica Neue",
      "sans-serif",
    ].join(","),
  },
})

export default theme
