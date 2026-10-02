import React, { useEffect, useState } from "react"
import { embedUrl, formatCount, formatDate, getComments, getPopular, getVideo, searchVideos, timeAgo } from "./api"
import { ErrorPage, LinkedText, Loading, SideRow, VideoCard, VideoRow } from "./parts"

// Loads a page's data, keeping the IE status bar in step ("Opening page..." / "Done")
const useLoad = (load, deps, setStatus) => {
  const [state, setState] = useState({ data: null, error: null })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    setState({ data: null, error: null })
    setStatus("Opening page...")
    load().then(
      (data) => live && (setState({ data, error: null }), setStatus("Done")),
      (error) => live && (setState({ data: null, error }), setStatus("Error on page."))
    )
    return () => {
      live = false
    }
  }, [...deps, attempt])
  return { ...state, retry: () => setAttempt((n) => n + 1) }
}

// Previous / Next page links
const Pager = ({ prev, next, onPage, page }) =>
  prev || next ? (
    <div className="ytPager">
      {prev && (
        <button type="button" onClick={() => onPage(prev, page - 1)}>
          &laquo; Previous
        </button>
      )}
      <span>Page {page}</span>
      {next && (
        <button type="button" onClick={() => onPage(next, page + 1)}>
          Next &raquo;
        </button>
      )}
    </div>
  ) : null

export const Home = ({ navigate, setStatus }) => {
  const [paging, setPaging] = useState({ token: null, page: 1 })
  const { data, error, retry } = useLoad(() => getPopular(paging.token), [paging.token], setStatus)

  return (
    <section>
      <h2 className="ytHeading">Most Popular</h2>
      {error ? (
        <ErrorPage error={error} onRetry={retry} />
      ) : !data ? (
        <Loading />
      ) : (
        <>
          <div className="ytGrid">
            {data.videos.map((video) => (
              <VideoCard key={video.id} video={video} navigate={navigate} />
            ))}
          </div>
          <Pager prev={data.prevPageToken} next={data.nextPageToken} page={paging.page} onPage={(token, page) => setPaging({ token, page })} />
        </>
      )}
    </section>
  )
}

export const Results = ({ q, navigate, setStatus, setLastResults }) => {
  const [paging, setPaging] = useState({ token: null, page: 1 })
  const { data, error, retry } = useLoad(() => searchVideos(q, paging.token), [q, paging.token], setStatus)

  useEffect(() => {
    if (data) setLastResults(data.videos)
  }, [data])

  if (error) return <ErrorPage error={error} onRetry={retry} />
  if (!data) return <Loading label={`Searching for "${q}"...`} />

  const first = (paging.page - 1) * 20 + 1
  return (
    <section>
      <div className="ytResultsBar">
        {data.videos.length ? (
          <>
            Results <b>{first}</b> - <b>{first + data.videos.length - 1}</b> of about <b>{formatCount(data.total)}</b> for <b>{q}</b>
          </>
        ) : (
          <>
            No videos found for <b>{q}</b>
          </>
        )}
      </div>
      {data.videos.map((video) => (
        <VideoRow key={video.id} video={video} navigate={navigate} />
      ))}
      <Pager prev={data.prevPageToken} next={data.nextPageToken} page={paging.page} onPage={(token, page) => setPaging({ token, page })} />
    </section>
  )
}

const Comments = ({ id, total }) => {
  const [state, setState] = useState({ comments: [], next: null, loading: true, error: null, disabled: false })

  const load = (pageToken) => {
    setState((s) => ({ ...s, loading: true }))
    getComments(id, pageToken).then(
      (data) =>
        setState((s) => ({
          comments: [...(pageToken ? s.comments : []), ...data.comments],
          next: data.nextPageToken,
          loading: false,
          error: null,
          disabled: !!data.disabled,
        })),
      (error) => setState((s) => ({ ...s, loading: false, error }))
    )
  }

  useEffect(() => load(null), [id])

  return (
    <section className="ytBox">
      <h3 className="ytBoxTitle">Comments &amp; Responses{total != null ? ` (${formatCount(total)})` : ""}</h3>
      {state.disabled ? (
        <p className="ytMeta">Comments are disabled for this video.</p>
      ) : state.error ? (
        <p className="ytMeta">Comments couldn't be loaded. {state.error.message}</p>
      ) : (
        <>
          {state.comments.map((comment) => (
            <div key={comment.id} className="ytComment">
              <div className="ytCommentHead">
                <span className="ytChannel">{comment.author}</span>
                <span className="ytMeta"> ({timeAgo(comment.publishedAt)})</span>
              </div>
              <div className="ytCommentText">{comment.text}</div>
              <div className="ytMeta">
                {comment.likes ? `${formatCount(comment.likes)} likes` : ""}
                {comment.replies ? ` · ${comment.replies} ${comment.replies === 1 ? "reply" : "replies"}` : ""}
              </div>
            </div>
          ))}
          {!state.loading && !state.comments.length && <p className="ytMeta">No comments yet.</p>}
          {state.loading ? (
            <Loading label="Loading comments..." />
          ) : (
            state.next && (
              <button type="button" className="ytMore" onClick={() => load(state.next)}>
                Show more comments
              </button>
            )
          )}
        </>
      )}
    </section>
  )
}

export const Watch = ({ id, navigate, setStatus, isFavorite, toggleFavorite, lastResults, onShare }) => {
  const { data, error, retry } = useLoad(() => getVideo(id), [id], setStatus)
  const [expanded, setExpanded] = useState(false)

  if (error) return <ErrorPage error={error} onRetry={retry} />
  if (!data) return <Loading />

  const { video, channel, more } = data
  const related = lastResults.filter((v) => v.id !== id).slice(0, 12)
  const favorite = isFavorite(id)

  return (
    <div className="ytWatch">
      <div className="ytWatchMain">
        <h1 className="ytWatchTitle">{video.title}</h1>
        <div className="ytPlayer">
          <iframe
            src={`${embedUrl(id)}?autoplay=1&rel=0&playsinline=1`}
            title={video.title}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
          />
        </div>
        <div className="ytActions">
          <div className="ytStats">
            {video.views != null && (
              <span>
                Views: <b>{formatCount(video.views)}</b>
              </span>
            )}
            {video.likes != null && (
              <span>
                Likes: <b>{formatCount(video.likes)}</b>
              </span>
            )}
          </div>
          <div className="ytActionButtons">
            <button type="button" onClick={() => toggleFavorite(video)} aria-pressed={favorite}>
              {favorite ? "★ Favorited" : "☆ Favorite"}
            </button>
            <button type="button" onClick={() => onShare(video)}>
              Share
            </button>
          </div>
        </div>

        <section className="ytBox ytAbout">
          <div className="ytFrom">
            {channel?.thumbnail && <img src={channel.thumbnail} alt="" className="ytAvatar" />}
            <div>
              <div>
                From: <span className="ytChannel">{video.channelTitle}</span>
              </div>
              <div className="ytMeta">
                {channel?.subscribers != null && `${formatCount(channel.subscribers)} subscribers · `}
                {channel?.videoCount != null && `${formatCount(channel.videoCount)} videos`}
              </div>
            </div>
          </div>
          <div className="ytMeta">Added: {formatDate(video.publishedAt)}</div>
          {video.description && (
            <>
              <p className={expanded ? "ytDescription" : "ytDescription is-collapsed"}>
                <LinkedText text={video.description} navigate={navigate} />
              </p>
              <button type="button" className="ytLinkButton" onClick={() => setExpanded(!expanded)}>
                {expanded ? "(less info)" : "(more info)"}
              </button>
            </>
          )}
        </section>

        <Comments id={id} total={video.comments} />
      </div>

      <aside className="ytWatchSide">
        {more.length > 0 && (
          <section className="ytBox">
            <h3 className="ytBoxTitle">More From: {video.channelTitle}</h3>
            {more.map((v) => (
              <SideRow key={v.id} video={v} navigate={navigate} />
            ))}
          </section>
        )}
        {related.length > 0 && (
          <section className="ytBox">
            <h3 className="ytBoxTitle">Related Videos</h3>
            {related.map((v) => (
              <SideRow key={v.id} video={v} navigate={navigate} />
            ))}
          </section>
        )}
      </aside>
    </div>
  )
}

export const Favorites = ({ favorites, navigate, toggleFavorite, setStatus }) => {
  useEffect(() => setStatus("Done"), [])
  return (
    <section>
      <h2 className="ytHeading">My Favorites</h2>
      {favorites.length === 0 ? (
        <p className="ytEmpty">You haven't added any favorites yet. Click "Favorite" under a video to save it here.</p>
      ) : (
        <div className="ytGrid">
          {favorites.map((video) => (
            <div key={video.id} className="ytFavorite">
              <VideoCard video={video} navigate={navigate} />
              <button type="button" className="ytLinkButton" onClick={() => toggleFavorite(video)}>
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
