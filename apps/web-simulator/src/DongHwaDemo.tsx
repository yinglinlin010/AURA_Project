import { useState, useEffect } from 'react';
import './DongHwaDemo.css';
import campusPanorama from './assets/dong-hwa/campus-panorama.jpg';
import campusLake from './assets/dong-hwa/campus-lake.jpg';

type Scene = 'overview' | 'fly-screen' | 'offline' | 'blind-spot';
type FlyScreenState = 'idle' | 'proposing' | 'confirming' | 'updated';

export default function DongHwaDemo() {
    const [scene, setScene] = useState<Scene>('overview');
    const [showControls, setShowControls] = useState(true);
    const [flyScreenState, setFlyScreenState] = useState<FlyScreenState>('idle');
    const [itineraryAdded, setItineraryAdded] = useState(false);
    const [dimLevel, setDimLevel] = useState(60);

    // Scene 2: Fly-screen animation sequencing (Manual approval required)
    useEffect(() => {
        if (scene === 'fly-screen' && flyScreenState === 'idle') {
            setFlyScreenState('proposing');
            // Auto fly to center to prompt user, but wait for manual approval
            const timer = setTimeout(() => {
                if (!itineraryAdded) {
                    setFlyScreenState('confirming');
                } else {
                    setFlyScreenState('updated');
                }
            }, 1500);
            return () => clearTimeout(timer);
        }
    }, [scene, flyScreenState, itineraryAdded]);

    const handleApprove = () => {
        setItineraryAdded(true);
        setFlyScreenState('updated');
    };

    const handleDecline = () => {
        setFlyScreenState('idle');
    };

    const resetDemo = () => {
        setScene('overview');
        setFlyScreenState('idle');
        setItineraryAdded(false);
        setDimLevel(60);
    };

    // Keyboard controls for hiding director panel and switching scenes
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'h' || e.key === 'H') setShowControls(prev => !prev);
            if (e.key === '1') setScene('overview');
            if (e.key === '2') setScene('fly-screen');
            if (e.key === '3') setScene('offline');
            if (e.key === '4') setScene('blind-spot');
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    return (
        <div className="dong-hwa-demo">
            {/* Main 5-Screen Simulation Area */}
            <div className="simulation-container">

                <div className="ambient-background" style={{
                    backgroundImage: `url(${campusPanorama})`,
                    filter: scene === 'offline' ? `brightness(${1 - dimLevel / 100})` : 'brightness(1)'
                }}>
                    <div className="ambient-overlay"></div>
                </div>

                <div className="screens-wrapper">
                    {/* 1. Simulated Left Window */}
                    <div className={`screen-panel window-panel left-window ${scene === 'blind-spot' ? 'warning-active' : ''}`}>
                        <div className="panel-header">Passenger Window (L)</div>
                        <div className="panel-content">
                            {scene === 'fly-screen' && flyScreenState === 'proposing' && (
                                <div className="proposal-card fly-out">
                                    <h4>POI Suggestion</h4>
                                    <h3>Dong Lake</h3>
                                    <p className="hint-text">Swiping to Center...</p>
                                    <img src={campusLake} alt="Dong Lake" className="poi-image-small" />
                                </div>
                            )}
                            {scene === 'blind-spot' && (
                                <div className="blind-spot-warning">
                                    <span className="warning-icon">⚠️</span>
                                    <div>
                                        <p>Vehicle in Blind Spot</p>
                                        <small className="simulated-badge">SIMULATED</small>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* 2. Simulated Cluster */}
                    <div className="screen-panel cluster-panel">
                        <div className="panel-header">Instrument Cluster</div>
                        <div className="panel-content cluster-content">
                            <div className="speedometer">65 <span className="unit">km/h</span></div>
                            {scene === 'blind-spot' && (
                                <div className="cluster-warning">
                                    <span className="warning-icon">⚠️</span>
                                    Left Blind Spot Active
                                    <span className="simulated-badge">SIMULATED</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* 3. Simulated Center Screen */}
                    <div className="screen-panel center-panel">
                        <div className="panel-header">Center Console</div>
                        <div className="panel-content center-content">
                            {scene === 'fly-screen' && flyScreenState === 'confirming' && (
                                <div className="proposal-card fly-in">
                                    <h4>Confirm Destination</h4>
                                    <h3>Navigate to Dong Lake?</h3>
                                    <img src={campusLake} alt="Dong Lake" className="poi-image-medium" />
                                    <div className="action-buttons">
                                        <button className="btn-confirm" onClick={handleApprove}>Add to Itinerary</button>
                                        <button className="btn-cancel" onClick={handleDecline}>Decline</button>
                                    </div>
                                </div>
                            )}
                            {itineraryAdded && (scene === 'fly-screen' || scene === 'overview' || scene === 'blind-spot') && flyScreenState !== 'confirming' && (
                                <div className="itinerary-updated">
                                    <div className="success-check">✓</div>
                                    <h3>Itinerary Active</h3>
                                    <p>Routing to Dong Lake, National Dong Hwa University.</p>
                                </div>
                            )}
                            {!itineraryAdded && scene === 'overview' && (
                                <div className="overview-content">
                                    <h3>AURA System Active</h3>
                                    <p>Standby for interaction.</p>
                                </div>
                            )}
                            {scene === 'offline' && (
                                <div className="offline-notice">
                                    <div className="offline-icon">📶 ❌</div>
                                    <h3>WAN Offline</h3>
                                    <div className="offline-slider-container">
                                        <label>Simulated Dimming Level: {dimLevel}%</label>
                                        <input type="range" min="0" max="100" value={dimLevel} onChange={(e) => setDimLevel(Number(e.target.value))} />
                                    </div>
                                    <div className="cached-info-card">
                                        <h4>Cached Local Info</h4>
                                        <p><strong>National Dong Hwa University</strong></p>
                                        <p>A scenic campus located in Hualien, Taiwan.</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* 4. Simulated Right Window */}
                    <div className="screen-panel window-panel right-window">
                        <div className="panel-header">Passenger Window (R)</div>
                        <div className="panel-content">
                            <p className="hint-text">Standby</p>
                        </div>
                    </div>

                    {/* 5. Simulated Rear Screen */}
                    <div className="screen-panel rear-panel">
                        <div className="panel-header">Rear Screen</div>
                        <div className="panel-content">
                            <p className="hint-text">Media & Climate Control Standby</p>
                        </div>
                    </div>
                </div>

                {/* Attribution - Required */}
                <div className="attribution">
                    <p>Demo & Simulated Interactive UI Only</p>
                    <p>Photos by National Dong Hwa University:</p>
                    <p>1. apps/web-simulator/src/assets/dong-hwa/campus-panorama.jpg</p>
                    <p>2. apps/web-simulator/src/assets/dong-hwa/campus-lake.jpg</p>
                </div>
            </div>

            {/* Director Controls */}
            {showControls && (
                <div className="director-controls">
                    <div className="director-header">
                        <h2>Director Controls</h2>
                        <span className="hint-text">Press 'H' to hide</span>
                    </div>
                    <div className="control-buttons">
                        <button onClick={() => setScene('overview')} className={scene === 'overview' ? 'active' : ''}>1. Overview (5 Screens)</button>
                        <button onClick={() => setScene('fly-screen')} className={scene === 'fly-screen' ? 'active' : ''}>2. Fly-Screen Proposal</button>
                        <button onClick={() => setScene('offline')} className={scene === 'offline' ? 'active' : ''}>3. WAN Offline</button>
                        <button onClick={() => setScene('blind-spot')} className={scene === 'blind-spot' ? 'active' : ''}>4. Blind Spot Alert</button>
                        <button onClick={resetDemo} className="btn-reset">Reset History</button>
                    </div>
                </div>
            )}
        </div>
    );
}
