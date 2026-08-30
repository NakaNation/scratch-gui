import bindAll from 'lodash.bindall';
import React from 'react';
import PropTypes from 'prop-types';
import {connect} from 'react-redux';
import VM from 'scratch-vm';

import {getIsShowingProject, getIsAnyCreatingNewState} from '../reducers/project-state';
import {setProjectUnchanged} from '../reducers/project-changed';
import {setProjectTitle} from '../reducers/project-title';
import {readAutosave, writeAutosave, clearAutosave} from './autosave-storage';
import log from './log';

// Wait this long after the last edit before writing. Dragging a block fires
// several PROJECT_CHANGED events in a row and there is no point serialising the
// project for each one.
const SAVE_DEBOUNCE = 3000;

// ...but a student who never pauses for three seconds still deserves a save, so
// never let this long pass with unsaved changes.
const SAVE_MAX_WAIT = 30000;

/* Higher Order Component that keeps the current project in the browser and puts
 * it back on the next visit. This editor has no accounts and no project server,
 * so without it a reload is indistinguishable from starting over.
 * @param {React.Component} WrappedComponent: component to render
 * @returns {React.Component} component that autosaves
 */
const AutosaveHOC = function (WrappedComponent) {
    class AutosaveComponent extends React.Component {
        constructor (props) {
            super(props);
            bindAll(this, [
                'handleProjectChanged',
                'save'
            ]);
            this.timeout = null;
            this.oldestUnsavedChange = 0;
            this.saving = false;
            // The GUI loads an empty project of its own on startup. Restoring
            // before that finishes means it lands on top of our work, so
            // everything here waits for the first project to be on screen.
            this.started = false;
        }
        componentDidMount () {
            this.props.vm.on('PROJECT_CHANGED', this.handleProjectChanged);
        }
        componentDidUpdate (prevProps) {
            if (this.props.isShowingProject && !this.started) {
                this.started = true;
                this.restore();
            }
            // File > New means "give me a blank project", so the autosave has to
            // go with it - otherwise the next reload hands the old work straight
            // back. The `started` guard is what separates a real File > New from
            // the identical-looking load the GUI does on startup.
            if (this.started && this.props.isCreatingNew && !prevProps.isCreatingNew) {
                this.forget();
            }
        }
        componentWillUnmount () {
            this.props.vm.removeListener('PROJECT_CHANGED', this.handleProjectChanged);
            clearTimeout(this.timeout);
        }
        restore () {
            // A link to a specific project is an explicit request for that
            // project, and beats whatever was last open in this browser.
            if (/#\d+/.test(window.location.hash)) return;
            readAutosave()
                .then(record => {
                    if (!record || !record.project) return null;
                    return this.props.vm.loadProject(record.project).then(() => {
                        if (record.title) this.props.onSetProjectTitle(record.title);
                        this.props.onSetProjectUnchanged();
                        log(`Restored the project saved at ${new Date(record.savedAt)}`);
                    });
                })
                .catch(e => log.warn('Could not restore the saved project', e));
        }
        forget () {
            clearTimeout(this.timeout);
            this.oldestUnsavedChange = 0;
            clearAutosave().catch(e => log.warn('Could not clear the saved project', e));
        }
        handleProjectChanged () {
            // Loading a project counts as changing it, so the restore above
            // would otherwise save the thing it just read back.
            if (!this.started) return;
            if (!this.oldestUnsavedChange) this.oldestUnsavedChange = Date.now();
            clearTimeout(this.timeout);
            if (Date.now() - this.oldestUnsavedChange >= SAVE_MAX_WAIT) {
                this.save();
            } else {
                this.timeout = setTimeout(this.save, SAVE_DEBOUNCE);
            }
        }
        save () {
            // Serialising a large project is not instant. Stacking a second
            // save on top of one still running wins nothing, so wait it out.
            if (this.saving) {
                this.timeout = setTimeout(this.save, SAVE_DEBOUNCE);
                return;
            }
            this.saving = true;
            this.oldestUnsavedChange = 0;
            this.props.vm.saveProjectSb3()
                .then(blob => blob.arrayBuffer())
                .then(project => writeAutosave({
                    project,
                    title: this.props.projectTitle,
                    savedAt: Date.now()
                }))
                .catch(e => log.warn('Could not save the project', e))
                .then(() => {
                    this.saving = false;
                });
        }
        render () {
            const {
                /* eslint-disable no-unused-vars */
                isCreatingNew: isCreatingNewProp,
                isShowingProject: isShowingProjectProp,
                onSetProjectTitle: onSetProjectTitleProp,
                onSetProjectUnchanged: onSetProjectUnchangedProp,
                projectTitle: projectTitleProp,
                /* eslint-enable no-unused-vars */
                ...componentProps
            } = this.props;
            return (
                <WrappedComponent
                    {...componentProps}
                />
            );
        }
    }
    AutosaveComponent.propTypes = {
        isCreatingNew: PropTypes.bool,
        isShowingProject: PropTypes.bool,
        onSetProjectTitle: PropTypes.func,
        onSetProjectUnchanged: PropTypes.func,
        projectTitle: PropTypes.string,
        vm: PropTypes.instanceOf(VM).isRequired
    };
    const mapStateToProps = state => {
        const loadingState = state.scratchGui.projectState.loadingState;
        return {
            isCreatingNew: getIsAnyCreatingNewState(loadingState),
            isShowingProject: getIsShowingProject(loadingState),
            projectTitle: state.scratchGui.projectTitle,
            vm: state.scratchGui.vm
        };
    };
    const mapDispatchToProps = dispatch => ({
        onSetProjectTitle: title => dispatch(setProjectTitle(title)),
        onSetProjectUnchanged: () => dispatch(setProjectUnchanged())
    });
    // Allow incoming props to override redux-provided props. Used to mock in tests.
    const mergeProps = (stateProps, dispatchProps, ownProps) => Object.assign(
        {}, stateProps, dispatchProps, ownProps
    );
    return connect(
        mapStateToProps,
        mapDispatchToProps,
        mergeProps
    )(AutosaveComponent);
};

export {
    AutosaveHOC as default
};
