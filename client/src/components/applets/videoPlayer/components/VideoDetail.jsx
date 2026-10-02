import { useState } from "react"
import { LOBBY, useAim } from "../../aim/AimContext"

const VideoDetail = ({ video }) => {
    const aim = useAim()
    const [shareStatus, setShareStatus] = useState(null)

    if (!video) {
      return <div className ="d-flex flex-column align-items-center">
         <h1>Enter search keyword to load...</h1>
         <br></br>
         <p style={{fontSize:'25px'}}>
         Search up some videos and stuff. Go ahead.       
  
         </p>
      </div>;
    }
  
    const videoSrc = `https://www.youtube.com/embed/${video.id.videoId}`;
    return (
      <div className="container">
        <iframe src={videoSrc} className="videoFrame w-100 px-2" allowFullScreen/>
    
        <div className="container-fluid mt-1">
          <h4>{video.snippet.title}</h4>

          <div className="row">
            <div className="col-9 d-flex align-items-center">
              {video.snippet.description ?
              <p className="lead mb-0 videoDescription">{video.snippet.description}</p> :
              <p className="lead mb-0 videoDescription">No description available</p>
              }
            </div>
            <div className="col-3 text-end">
              {/* Posts the video to the 98ish Lobby chat room in 98 Messenger */}
              <button
                className="btn btn-success"
                onClick={async () => {
                  const result = await aim.shareVideo(videoSrc)
                  setShareStatus(result.ok ? `Shared in ${LOBBY}!` : result.error)
                }}
              >
              Share Video!
              </button>
              {shareStatus && <p className="small mb-0 mt-1">{shareStatus}</p>}
            </div>
          </div>
        </div>
        
      </div>
    );
  };
  
  export default VideoDetail;