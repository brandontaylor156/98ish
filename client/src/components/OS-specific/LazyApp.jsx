import React, { Suspense } from "react"

// Apps load the first time they're opened, so the desktop itself starts fast. While one
// loads its window shows an hourglass; if loading fails (say, the site was updated
// since this page loaded) it offers to reload.

const Loading = () => (
  <div className="appLoading" role="status">
    <span className="appLoadingGlass motion-ok" aria-hidden="true" />
    Loading...
  </div>
)

class LoadFailed extends React.Component {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="appLoading">
        <p>This program couldn't be loaded. 98ish may have been updated.</p>
        <button type="button" onClick={() => window.location.reload()}>
          Restart 98ish
        </button>
      </div>
    )
  }
}

export const lazyApp = (load) => {
  const Component = React.lazy(load)
  const App = (props) => (
    <LoadFailed>
      <Suspense fallback={<Loading />}>
        <Component {...props} />
      </Suspense>
    </LoadFailed>
  )
  App.preload = load
  return App
}
