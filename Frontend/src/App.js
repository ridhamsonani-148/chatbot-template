"use client"

import { useState, useEffect } from "react"
import theme from "./theme"
import { ThemeProvider } from "@mui/material/styles"
import AppHeader from "./Components/AppHeader"
import LeftNav from "./Components/LeftNav"
import ChatHeader from "./Components/ChatHeader"
import ChatBody from "./Components/ChatBody"
import useMediaQuery from "@mui/material/useMediaQuery"
import { CssBaseline, Box, Drawer } from "@mui/material"
import { CHAT_LEFT_PANEL_BACKGROUND, CHAT_BODY_BACKGROUND } from "./utilities/constants"

function App() {
  const [showLeftNav, setLeftNav] = useState(true)
  const isMobile = useMediaQuery("(max-width:768px)")
  const isSmallScreen = useMediaQuery("(max-width:600px)")

  // Close navbar automatically on small screens
  useEffect(() => {
    if (isMobile) {
      setLeftNav(false)
    } else {
      setLeftNav(true)
    }
  }, [isMobile])

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
        {/* App Header */}
        <AppHeader showLeftNav={showLeftNav} setLeftNav={setLeftNav} />

        {/* Main Content Area */}
        <Box
          sx={{
            height: isSmallScreen ? "calc(100vh - 4rem)" : "calc(100vh - 5rem)",
            display: "flex",
            position: "relative",
            overflow: "hidden", // Prevent overall scrolling
          }}
        >
          {/* Left Navigation - Drawer on small screens, permanent sidebar on larger screens */}
          {isSmallScreen ? (
            <Drawer
              variant="temporary"
              open={showLeftNav}
              onClose={() => setLeftNav(false)}
              ModalProps={{ keepMounted: true }}
              sx={{
                "& .MuiDrawer-paper": {
                  width: "280px",
                  backgroundColor: CHAT_LEFT_PANEL_BACKGROUND,
                  boxSizing: "border-box",
                },
              }}
            >
              <LeftNav showLeftNav={true} setLeftNav={setLeftNav} />
            </Drawer>
          ) : (
            <Box
              sx={{
                width: showLeftNav ? (isMobile ? "250px" : "300px") : "40px",
                flexShrink: 0,
                backgroundColor: CHAT_LEFT_PANEL_BACKGROUND,
                transition: "width 0.3s ease-in-out",
                overflow: "hidden",
              }}
            >
              <LeftNav showLeftNav={showLeftNav} setLeftNav={setLeftNav} />
            </Box>
          )}

          {/* Chat Content Area - Always visible */}
          <Box
            sx={{
              flexGrow: 1,
              height: "100%",
              backgroundColor: CHAT_BODY_BACKGROUND,
              padding: {
                xs: "0.5rem 0.5rem 0", // Remove bottom padding
                sm: "0.75rem 1rem 0", // Reduce top padding
                md: "1rem 5% 0", // Reduce top padding
                lg: "1rem 10% 0", // Reduce top padding
              },
              display: "flex",
              flexDirection: "column",
              overflow: "hidden", // Prevent scrolling at this level
              position: "relative",
            }}
          >
            <ChatHeader />
            <Box
              sx={{
                flex: "1 1 auto",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                position: "relative",
                minHeight: 0, // Allow flex items to shrink below content size
              }}
            >
              <ChatBody />
            </Box>
          </Box>
        </Box>
      </Box>
    </ThemeProvider>
  )
}

export default App
