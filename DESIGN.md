---
version: alpha
name: ClearDoc
description: Clean, trustworthy, and empowering design for document analysis and legal empowerment.
colors:
  primary: "#1A1C1E"  # Deep ink - Near-black
  secondary: "#6C7278"  # Muted gray
  accent: "#0066FF"  # Clear blue - Trust and clarity
  success: "#10B981"  # Emerald - Positive outcomes
  warning: "#F59E0B"  # Amber - Caution
  error: "#EF4444"  # Red - Issues/illegal content
  background: "#FFFFFF"  # Clean white
  surface: "#F8FAFC"  # Light gray surface
typography:
  display:
    fontFamily: "Syne", sans-serif
    fontSize: "3rem"
    fontWeight: "700"
    lineHeight: "1.1"
    letterSpacing: "-0.02em"
  heading:
    fontFamily: "Syne", sans-serif
    fontSize: "2.25rem"
    fontWeight: "600"
    lineHeight: "1.2"
  body:
    fontFamily: "DM Sans", sans-serif
    fontSize: "1rem"
    fontWeight: "400"
    lineHeight: "1.5"
  caption:
    fontFamily: "DM Sans", sans-serif
    fontSize: "0.875rem"
    fontWeight: "400"
    lineHeight: "1.4"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  xxl: "48px"
radius:
  sm: "4px"
  md: "8px"
  lg: "12px"
  xl: "16px"
shadow:
  sm: "0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)"
  md: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)"
  lg: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#FFFFFF"
    padding: "{spacing.md} {spacing.lg}"
    rounded: "{radius.md}"
    fontWeight: "600"
  button-primary-hover:
    backgroundColor: "{colors.primary}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    padding: "{spacing.md} {spacing.lg}"
    rounded: "{radius.md}"
    border: "1px solid {colors.primary}"
    fontWeight: "600"
  button-secondary-hover:
    backgroundColor: "{colors.primary}"
    textColor: "#FFFFFF"
  card:
    backgroundColor: "{colors.background}"
    borderRadius: "{radius.lg}"
    boxShadow: "{shadow.md}"
    padding: "{spacing.lg}"
  input:
    border: "1px solid {colors.secondary}"
    borderRadius: "{radius.md}"
    padding: "{spacing.md}"
    backgroundColor: "{colors.background}"
    color: "{colors.primary}"
  input-focus:
    borderColor: "{colors.accent}"
    boxShadow: "0 0 0 3px rgba(0, 102, 255, 0.25)"
---
# ClearDoc Design System

## Overview
ClearDoc's visual identity communicates trust, clarity, and empowerment. The design system balances professionalism with approachability, making complex legal documents feel understandable and actionable.

## Colors
- **Primary (#1A1C1E)**: Deep ink for text and core elements - conveys seriousness and trust
- **Accent (#0066FF)**: Clear blue for calls-to-action and highlights - represents clarity and trust
- **Success (#10B981)**: Emerald green for positive outcomes and verification
- **Warning (#F59E0B)**: Amber for cautionary information
- **Error (#EF4444)**: Red for illegal or problematic content
- **Background (#FFFFFF)**: Pure white for clean, readable surfaces
- **Surface (#F8FAFC)**: Light gray for elevated containers and cards

## Typography
- **Display/Heading**: Syne font - distinctive, modern, and authoritative for headlines
- **Body/Caption**: DM Sans font - highly readable, neutral, and accessible for body text

## Spacing & Radius
Consistent 8px-based spacing system with rounded corners (8px standard) for a soft, approachable feel.

## Shadows
Subtle shadows for depth without heaviness - maintains the clean, light aesthetic.

## Components
- Primary buttons use the accent color with white text
- Secondary buttons use surface background with primary text and border
- Cards feature white backgrounds with subtle shadows and rounded corners
- Inputs have clear focus states for accessibility

This design system ensures ClearDoc feels trustworthy, professional, and empowering - helping users feel confident when dealing with intimidating documents.