import React from "react"
import PixelArt from "../../shared/PixelArt"
import { artFor } from "./weatherArt"

// One of Weather's pixel-art icons (weatherArt.js), at any size.
const WeatherIcon = ({ icon, size = 32, label, className }) => <PixelArt art={artFor(icon)} size={size} label={label} className={className ? `wxIcon ${className}` : "wxIcon"} />

export default WeatherIcon
