import {useState, useRef, useEffect} from "react"
import { searchVideos } from './apis/youtube'
import SearchBar from './components/SearchBar';
import VideoList from './components/VideoList';
import VideoDetail from './components/VideoDetail';

const VideoPlayer = () => {
    const [videos, setVideos] = useState([])
    const [selectedVideo, setSelectedVideo] = useState(null)

    const topRef = useRef(null)
    const executeScroll = () => topRef.current.scrollIntoView()

    const handleSubmit = async (termFromSearchBar) => {
      try {
        setVideos(await searchVideos(termFromSearchBar))
      } catch (err) {
        console.error(err)
        setVideos([])
      }
    };

    const handleVideoSelect = (video) => {
      setSelectedVideo(video)
    }

    return (
      <div style={{height: 'calc(100% - 25px)', overflowY: 'scroll', overflowX: 'hidden'}}>
          <div className="row">
            <div className="d-flex justify-content-center flex-column align-items-center" ref={topRef}>
              <SearchBar handleFormSubmit={handleSubmit}/>
            </div>
            <div className="my-3">
              <VideoDetail video={selectedVideo}/>
            </div>
          </div>
          
          <VideoList executeScroll={executeScroll} handleVideoSelect={handleVideoSelect} videos={videos}/>
      </div>
  )
}
  
export default VideoPlayer;