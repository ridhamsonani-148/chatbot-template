"use client"

import { AppBar, Toolbar, Button, Box, Typography, useMediaQuery, IconButton } from "@mui/material"
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown"
import MenuIcon from "@mui/icons-material/Menu"
// Import Catholic symbol from Assets folder
import CatholicSymbol from "../Assets/catholic.svg"
import { PRIMARY_MAIN, CHAT_BODY_BACKGROUND, primary_50 } from "../utilities/constants"

function AppHeader({ showLeftNav, setLeftNav }) {
  const isSmallScreen = useMediaQuery("(max-width:600px)")

  return (
    <AppBar
      position="static"
      sx={{
        backgroundColor: CHAT_BODY_BACKGROUND,
        height: isSmallScreen ? "4rem" : "5rem",
        boxShadow: "none",
        borderBottom: `1.5px solid ${primary_50}`,
      }}
    >
      <Toolbar
        sx={{
          height: "100%",
          padding: {
            xs: "0 0.5rem",
            sm: "0 1rem",
            md: "0 2rem",
            lg: "0 3rem",
          },
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        {/* Left side with menu button (small screens) and logo */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          {isSmallScreen && (
            <IconButton
              edge="start"
              color="inherit"
              aria-label="menu"
              onClick={() => setLeftNav(true)}
              sx={{ color: PRIMARY_MAIN }}
            >
              <MenuIcon />
            </IconButton>
          )}
          <img
            src={CatholicSymbol || "/placeholder.svg"}
            alt="Catholic Symbol"
            width={isSmallScreen ? "30" : "40"}
            height={isSmallScreen ? "30" : "40"}
          />
          <Typography
            variant={isSmallScreen ? "h6" : "h5"}
            sx={{
              fontWeight: "bold",
              color: PRIMARY_MAIN,
              fontSize: isSmallScreen ? "1rem" : "1.5rem",
              whiteSpace: "nowrap",
            }}
          >
            Catholic Charity USA
          </Typography>
        </Box>

        {/* Right side with user button */}
        <Button
          variant="contained"
          endIcon={<KeyboardArrowDownIcon fontSize={isSmallScreen ? "small" : "medium"} />}
          sx={{
            backgroundColor: PRIMARY_MAIN,
            borderRadius: "2rem",
            padding: isSmallScreen ? "0.25rem 0.75rem" : "0.5rem 1.5rem",
            textTransform: "none",
            fontWeight: "bold",
            fontSize: isSmallScreen ? "0.8rem" : "0.9rem",
            minWidth: isSmallScreen ? "60px" : "auto",
          }}
        >
          USER
        </Button>
      </Toolbar>
    </AppBar>
  )
}

export default AppHeader
